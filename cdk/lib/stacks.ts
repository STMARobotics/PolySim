import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as api from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { resolve } from 'node:path';
import { production as config } from './config';
export class CertificateStack extends cdk.Stack {
    readonly certificate: acm.Certificate;
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
        super(scope,id,props);
        const zone=route53.HostedZone.fromHostedZoneAttributes(this,'Zone',{hostedZoneId:config.hostedZoneId,zoneName:config.domainName});
        this.certificate=new acm.Certificate(this,'Certificate',{domainName:config.hostname,validation:acm.CertificateValidation.fromDns(zone)});
    }
}
export class BackendStack extends cdk.Stack {
    readonly httpApi: api.HttpApi;
    readonly alarms: sns.Topic;
    readonly functions: lambda.Function[]=[];
    constructor(scope: Construct,id: string,props:cdk.StackProps) {
        super(scope,id,props);
        const table=(name: string,ttl=false)=>new ddb.Table(this,name,{
            partitionKey:{name:'pk',type:ddb.AttributeType.STRING},sortKey:{name:'sk',type:ddb.AttributeType.STRING},
            billingMode:ddb.BillingMode.PAY_PER_REQUEST,encryption:ddb.TableEncryption.AWS_MANAGED,
            pointInTimeRecoverySpecification:{pointInTimeRecoveryEnabled:false},deletionProtection:true,
            removalPolicy:cdk.RemovalPolicy.RETAIN,...(ttl?{timeToLiveAttribute:'ttl'}:{}),
        });
        const data=table('RobotData',true),sessions=table('Sessions',true);
        data.addGlobalSecondaryIndex({indexName:'GSI1',partitionKey:{name:'gsi1pk',type:ddb.AttributeType.STRING},sortKey:{name:'gsi1sk',type:ddb.AttributeType.STRING},projectionType:ddb.ProjectionType.ALL});
        this.alarms=new sns.Topic(this,'OperationsAlerts',{enforceSSL:true});
        const alarm=(id: string, metric:cw.IMetric,threshold=1)=>{
            const a=new cw.Alarm(this,id,{metric,threshold,evaluationPeriods:1,treatMissingData:cw.TreatMissingData.NOT_BREACHING});a.addAlarmAction(new actions.SnsAction(this.alarms));
        };
        const make=(name:'auth'|'robots'|'seasons')=>{
            const group=new logs.LogGroup(this,name+'Logs',{retention:logs.RetentionDays.ONE_MONTH,removalPolicy:cdk.RemovalPolicy.RETAIN});
            const fn=new lambda.Function(this,name+'Function',{
                runtime:lambda.Runtime.NODEJS_24_X,architecture:lambda.Architecture.ARM_64,handler:'index.handler',code:lambda.Code.fromAsset(resolve('service-dist',name)),
                memorySize:512,timeout:cdk.Duration.seconds(15),reservedConcurrentExecutions:name==='auth'?10:20,logGroup:group,
                environment:{APP_ENV:'production',APP_ORIGIN:'https://'+config.hostname,ALLOWED_DOMAIN:config.allowedDomain,GOOGLE_CLIENT_ID:config.googleClientId,GOOGLE_SECRET_PARAMETER:config.googleSecretParameter,DATA_TABLE:data.tableName,SESSIONS_TABLE:sessions.tableName,ADMIN_EMAILS:config.adminEmails.join(',')},
            });
            fn.addToRolePolicy(new iam.PolicyStatement({actions:['dynamodb:GetItem'],resources:[sessions.tableArn]}));
            alarm(name+'Errors',fn.metricErrors({period:cdk.Duration.minutes(5)}));
            alarm(name+'Throttles',fn.metricThrottles({period:cdk.Duration.minutes(5)}));
            alarm(name+'Latency',fn.metricDuration({period:cdk.Duration.minutes(5),statistic:'p95'}),10000);
            this.functions.push(fn);return fn;
        };
        const auth=make('auth'),robots=make('robots'),seasons=make('seasons');
        auth.addToRolePolicy(new iam.PolicyStatement({actions:['dynamodb:PutItem','dynamodb:DeleteItem'],resources:[sessions.tableArn]}));
        const parameterArn=this.formatArn({service:'ssm',resource:'parameter',resourceName:config.googleSecretParameter.slice(1)});
        auth.addToRolePolicy(new iam.PolicyStatement({actions:['ssm:GetParameter'],resources:[parameterArn]}));
        auth.addToRolePolicy(new iam.PolicyStatement({actions:['kms:Decrypt'],resources:['*'],conditions:{StringEquals:{'kms:ViaService':`ssm.${this.region}.amazonaws.com`,'kms:EncryptionContext:PARAMETER_ARN':parameterArn}}}));
        robots.addToRolePolicy(new iam.PolicyStatement({actions:['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem','dynamodb:Query'],resources:[data.tableArn,data.tableArn+'/index/GSI1']}));
        const access=new logs.LogGroup(this,'ApiAccessLogs',{retention:logs.RetentionDays.ONE_MONTH,removalPolicy:cdk.RemovalPolicy.RETAIN});
        this.httpApi=new api.HttpApi(this,'HttpApi',{apiName:'polysim-api',createDefaultStage:true});
        const stage=this.httpApi.defaultStage!.node.defaultChild as api.CfnStage;
        stage.accessLogSettings={destinationArn:access.logGroupArn,format:JSON.stringify({requestId:'$context.requestId',route:'$context.routeKey',status:'$context.status',latency:'$context.responseLatency'})};
        stage.defaultRouteSettings={throttlingBurstLimit:100,throttlingRateLimit:50,detailedMetricsEnabled:true};
        const route=(path:string,methods:api.HttpMethod[],fn:lambda.Function)=>this.httpApi.addRoutes({path,methods,integration:new integrations.HttpLambdaIntegration(path.replace(/\W/g,'')+methods.join(''),fn)});
        route('/api/auth/start',[api.HttpMethod.GET],auth);route('/api/auth/callback',[api.HttpMethod.GET],auth);route('/api/auth/session',[api.HttpMethod.GET],auth);route('/api/auth/logout',[api.HttpMethod.POST],auth);
        route('/api/robots',[api.HttpMethod.GET,api.HttpMethod.POST],robots);
        route('/api/robots/{robotId}',[api.HttpMethod.GET],robots);
        route('/api/robots/{robotId}/revisions',[api.HttpMethod.GET,api.HttpMethod.POST],robots);
        route('/api/robots/{robotId}/revisions/{revision}',[api.HttpMethod.GET],robots);
        route('/api/robots/{robotId}/archive',[api.HttpMethod.PATCH],robots);
        route('/api/seasons',[api.HttpMethod.GET],seasons);route('/api/seasons/{seasonId}',[api.HttpMethod.GET],seasons);
        alarm('ApiServerErrors',this.httpApi.metricServerError({period:cdk.Duration.minutes(5)}),5);
        new cdk.CfnOutput(this,'ApiUrl',{value:this.httpApi.apiEndpoint});
        new cdk.CfnOutput(this,'OperationsTopicArn',{value:this.alarms.topicArn});
        new cdk.CfnOutput(this,'DataTableName',{value:data.tableName});
        new cdk.CfnOutput(this,'SessionsTableName',{value:sessions.tableName});
    }
}
export class FrontendStack extends cdk.Stack {
    readonly distribution: cf.Distribution;
    constructor(scope: Construct,id: string,props:cdk.StackProps & {backend:BackendStack;edge:CertificateStack}) {
        super(scope,id,props);
        const site=new s3.Bucket(this,'Site',{blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,encryption:s3.BucketEncryption.S3_MANAGED,enforceSSL:true,versioned:true,removalPolicy:cdk.RemovalPolicy.RETAIN,lifecycleRules:[{noncurrentVersionExpiration:cdk.Duration.days(30),abortIncompleteMultipartUploadAfter:cdk.Duration.days(7)}]});
        const headers=new cf.ResponseHeadersPolicy(this,'SecurityHeaders',{securityHeadersBehavior:{
            contentSecurityPolicy:{override:true,contentSecurityPolicy:"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests"},
            contentTypeOptions:{override:true},frameOptions:{override:true,frameOption:cf.HeadersFrameOption.DENY},referrerPolicy:{override:true,referrerPolicy:cf.HeadersReferrerPolicy.NO_REFERRER},
            strictTransportSecurity:{override:true,accessControlMaxAge:cdk.Duration.days(365),includeSubdomains:false,preload:false},
        },customHeadersBehavior:{customHeaders:[{header:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()',override:true}]}});
        this.distribution=new cf.Distribution(this,'Distribution',{
            domainNames:[config.hostname],certificate:props.edge.certificate,
            defaultRootObject:'index.html',minimumProtocolVersion:cf.SecurityPolicyProtocol.TLS_V1_2_2021,
            defaultBehavior:{origin:origins.S3BucketOrigin.withOriginAccessControl(site),viewerProtocolPolicy:cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,allowedMethods:cf.AllowedMethods.ALLOW_GET_HEAD,cachePolicy:cf.CachePolicy.CACHING_DISABLED,responseHeadersPolicy:headers,compress:true},
        });
        const domain=cdk.Fn.select(2,cdk.Fn.split('/',props.backend.httpApi.apiEndpoint));
        this.distribution.addBehavior('/api/*',new origins.HttpOrigin(domain),{viewerProtocolPolicy:cf.ViewerProtocolPolicy.HTTPS_ONLY,allowedMethods:cf.AllowedMethods.ALLOW_ALL,cachePolicy:cf.CachePolicy.CACHING_DISABLED,originRequestPolicy:cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,responseHeadersPolicy:headers});
        const zone=route53.HostedZone.fromHostedZoneAttributes(this,'Zone',{hostedZoneId:config.hostedZoneId,zoneName:config.domainName});
        new route53.ARecord(this,'Alias',{zone,recordName:config.hostname,target:route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))});
        new route53.AaaaRecord(this,'AliasIPv6',{zone,recordName:config.hostname,target:route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))});
        new deploy.BucketDeployment(this,'Deploy',{sources:[deploy.Source.asset(resolve('dist'))],destinationBucket:site,distribution:this.distribution,distributionPaths:['/*'],prune:true,retainOnDelete:true,cacheControl:[deploy.CacheControl.noStore()]});
        new cdk.CfnOutput(this,'AppUrl',{value:'https://'+config.hostname});
        new cdk.CfnOutput(this,'DistributionId',{value:this.distribution.distributionId});
    }
}
