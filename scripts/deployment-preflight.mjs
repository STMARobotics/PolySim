// Read-only: validates the deployment account and region.
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {production} from '../cdk/lib/config.ts';
const {region,account}=production;
const configuredRegion=process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
if(configuredRegion!==region)throw Error('Wrong AWS region. Expected '+region);
const identity=await new STSClient({region}).send(new GetCallerIdentityCommand({}));
if(identity.Account!==account)throw Error('Wrong AWS account. Expected '+account);
console.log('Verified AWS account and region. OAuth secret access remains with the auth Lambda.');
