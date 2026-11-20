// Read-only: validates credentials and secret metadata, never prints the secret value.
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {SSMClient,GetParameterCommand} from '@aws-sdk/client-ssm';
import {production} from '../cdk/lib/config.ts';
const {region,account,googleSecretParameter}=production;
const identity=await new STSClient({region}).send(new GetCallerIdentityCommand({}));
if(identity.Account!==account)throw Error('Wrong AWS account. Expected '+account);
const metadata=await new SSMClient({region}).send(new GetParameterCommand({Name:googleSecretParameter,WithDecryption:false}));
if(metadata.Parameter?.Type!=='SecureString')throw Error('Shared Google OAuth SecureString is missing or has the wrong type.');
console.log('Verified AWS account, region and shared OAuth parameter metadata. Secret value was not read.');
