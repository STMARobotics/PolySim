import test from 'node:test';
import assert from 'node:assert/strict';
import {App} from 'aws-cdk-lib';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {BackendStack,CertificateStack,FrontendStack} from '../lib/stacks';
import {production} from '../lib/config';
import {readFileSync,readdirSync} from 'node:fs';
import {ENGINE_VERSION} from '../../contracts/model';
const app=new App({context:{'@aws-cdk/core:defaultCrossStackReferences':'strong'}}),env={account:production.account,region:production.region};
const edge=new CertificateStack(app,'test-certificate',{env:{...env,region:'us-east-1'},crossRegionReferences:true});
const backend=new BackendStack(app,'test-backend',{env,crossRegionReferences:true});
const frontend=new FrontendStack(app,'test-frontend',{env,crossRegionReferences:true,backend,edge});
const b=Template.fromStack(backend),f=Template.fromStack(frontend),e=Template.fromStack(edge);
test('deployment coordinates and Google configuration while resources are isolated to PolySim',()=>{
    assert.equal(backend.account,'738044534240');assert.equal(backend.region,'us-east-2');assert.equal(edge.region,'us-east-1');
    b.hasResourceProperties('AWS::Lambda::Function',{Runtime:'nodejs24.x',Architectures:['arm64'],Environment:{Variables:Match.objectLike({APP_ORIGIN:'https://polysim.7028robotics.com',ALLOWED_DOMAIN:'stmarobotics.org',GOOGLE_SECRET_PARAMETER:production.googleSecretParameter,ADMIN_EMAILS:'zack.osowski@stmarobotics.org,andy.gasser@stmarobotics.org'})}});
    e.hasResourceProperties('AWS::CertificateManager::Certificate',{DomainName:'polysim.7028robotics.com',ValidationMethod:'DNS'});
});
test('both DynamoDB tables have retention, encryption, PITR and deletion protection; data has a paginated index and backups',()=>{
    const tables=b.findResources('AWS::DynamoDB::Table');assert.equal(Object.keys(tables).length,2);
    for(const table of Object.values(tables)) {assert.equal(table.DeletionPolicy,'Retain');assert.equal(table.UpdateReplacePolicy,'Retain');assert.equal(table.Properties.DeletionProtectionEnabled,true);assert.equal(table.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled,true);assert.equal(table.Properties.SSESpecification.SSEEnabled,true);assert.equal(table.Properties.TimeToLiveSpecification.AttributeName,'ttl');}
    b.hasResourceProperties('AWS::DynamoDB::Table',{GlobalSecondaryIndexes:Match.arrayWith([Match.objectLike({IndexName:'GSI1'})])});
    b.resourceCountIs('AWS::Backup::BackupPlan',1);b.resourceCountIs('AWS::Backup::BackupSelection',1);
});
test('Lambda permissions contain no scans and give only the auth role access to the OAuth secret',()=>{
    const policies=b.findResources('AWS::IAM::Policy');
    const grants=Object.entries(policies).flatMap(([id,r])=>r.Properties.PolicyDocument.Statement.map((statement:any)=>({id,statement})));
    assert.ok(!grants.some(({statement})=>JSON.stringify(statement.Action).includes('dynamodb:Scan')));
    const secret=grants.filter(({statement})=>JSON.stringify(statement.Action).includes('ssm:GetParameter'));
    assert.equal(secret.length,1);assert.match(secret[0].id,/authFunction/);assert.ok(JSON.stringify(secret[0].statement.Resource).includes('parameter'+production.googleSecretParameter));
    const decrypt=grants.filter(({statement})=>JSON.stringify(statement.Action).includes('kms:Decrypt'));
    assert.equal(decrypt.length,1);assert.ok(decrypt[0].statement.Condition.StringEquals['kms:EncryptionContext:PARAMETER_ARN']);
});
test('CloudFront keeps the bucket private and never caches auth or API responses; security headers and WAF are enforced',()=>{
    f.hasResourceProperties('AWS::S3::Bucket',{PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},VersioningConfiguration:{Status:'Enabled'}});
    f.hasResourceProperties('AWS::CloudFront::OriginAccessControl',{OriginAccessControlConfig:Match.objectLike({SigningBehavior:'always',SigningProtocol:'sigv4'})});
    const dist=Object.values(f.findResources('AWS::CloudFront::Distribution'))[0].Properties.DistributionConfig;
    assert.ok(dist.WebACLId);const api=dist.CacheBehaviors.find((r:any)=>r.PathPattern==='/api/*');assert.ok(api);assert.equal(api.CachePolicyId,'4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    assert.equal(api.ViewerProtocolPolicy,'https-only');assert.ok(api.AllowedMethods.includes('POST'));
    f.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy',{ResponseHeadersPolicyConfig:{SecurityHeadersConfig:Match.objectLike({ContentSecurityPolicy:Match.objectLike({Override:true}),FrameOptions:{FrameOption:'DENY',Override:true}})}});
    e.hasResourceProperties('AWS::WAFv2::WebACL',{Scope:'CLOUDFRONT',VisibilityConfig:{SampledRequestsEnabled:false,CloudWatchMetricsEnabled:true,MetricName:'PolySimFirewall'}});
});
test('focused API routes cover auth, versioned robot storage and read-only seasons with logging and alarms',()=>{
    const routes=Object.values(b.findResources('AWS::ApiGatewayV2::Route')).map(r=>r.Properties.RouteKey);
    assert.ok(routes.includes('POST /api/robots/{robotId}/revisions'));assert.ok(routes.includes('POST /api/auth/logout'));
    assert.ok(!routes.some((r:string)=>r.startsWith('DELETE ')));assert.ok(!routes.some((r:string)=>r.startsWith('POST /api/seasons')));
    b.hasResourceProperties('AWS::ApiGatewayV2::Stage',{AccessLogSettings:Match.objectLike({Format:Match.stringLikeRegexp('requestId')})});
    assert.ok(Object.keys(b.findResources('AWS::CloudWatch::Alarm')).length>=10);
});
test('production entry is the login gate and lazy-loads the editor only after authentication',()=>{
    const html=readFileSync('dist/index.html','utf8'), entry=html.match(/src="([^\"]+\.js)"/)![1];
    const code=readFileSync('dist'+entry,'utf8');assert.ok(code.includes('/api/auth/session'));assert.ok(code.includes('Sign in with Google'));assert.ok(code.includes('stmarobotics.org accounts only'));
    assert.ok(!code.includes('new WebGLRenderer'));assert.ok(readdirSync('dist/assets').some(f=>f.startsWith('main-')));
    const worker=readdirSync('dist/assets').find(file=>/^worker-.*\.js$/.test(file));assert.ok(worker,'Production worker is published with the authenticated app');
    const physics=readFileSync(`dist/assets/${worker}`,'utf8');assert.ok(physics.includes('setCollisionGroups'));
    assert.ok(frontend.dependencies.includes(backend),'Backend capabilities deploy before their frontend');
    for(const dir of ['auth','robots','seasons']) {const lambda=readFileSync(`service-dist/${dir}/index.js`,'utf8');assert.ok(!lambda.includes('class MemoryStore'));assert.ok(!lambda.includes('test-code'));}
    assert.ok(readFileSync('service-dist/seasons/index.js','utf8').includes(ENGINE_VERSION),'Production manifest identifies the current engine');
});
test('one deployment workflow uses FMEA-style gates and no variables, secrets or pinned actions',()=>{
    const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
    assert.match(workflow,/github\.event_name == 'pull_request'/);
    assert.match(workflow,/github\.ref != 'refs\/heads\/main'/);
    assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow,/GitHubAction-PullRequestRole/);assert.match(workflow,/GitHubAction-AssumeRoleWithAction/);
    assert.match(workflow,/actions\/checkout@v7/);assert.match(workflow,/actions\/setup-node@v7/);assert.match(workflow,/configure-aws-credentials@v6/);
    assert.doesNotMatch(workflow,/\$\{\{\s*(vars|secrets)\./);assert.doesNotMatch(workflow,/uses: [^@\n]+@[0-9a-f]{40}/);
    assert.doesNotMatch(workflow,/workflow_dispatch/);
});
test('deployment preflight validates only account identity and never accesses SSM',()=>{
    const preflight=readFileSync('scripts/deployment-preflight.mjs','utf8');
    assert.match(preflight,/GetCallerIdentityCommand/);
    assert.doesNotMatch(preflight,/SSMClient|GetParameterCommand|DescribeParametersCommand/);
});
