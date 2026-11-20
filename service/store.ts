import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
export type Item = Record<string, any> & {pk: string; sk: string};
export type Condition = {absent: true} | {equals: Record<string, unknown>} | {expiresAfter: number};
export type Write = {table: string; item: Item; condition?: Condition} | {table: string; key: Pick<Item,'pk'|'sk'>; condition?: Condition; delete: true};
export class Conflict extends Error {}
export interface Store {
    get(table: string, pk: string, sk: string): Promise<Item|undefined>;
    put(table: string, item: Item): Promise<void>;
    consume(table: string, pk: string, sk: string, now: number): Promise<Item|undefined>;
    remove(table: string, pk: string, sk: string): Promise<void>;
    transaction(writes: Write[]): Promise<void>;
    list(table: string, partition: string, limit: number, after?: Record<string,unknown>, index?: boolean): Promise<{items: Item[]; cursor?: Record<string,unknown>}>;
}
function expression(condition?: Condition) {
    if(!condition)return {};
    if('absent' in condition)return {ConditionExpression:'attribute_not_exists(pk)'};
    if('expiresAfter' in condition)return {ConditionExpression:'#ttl > :now',ExpressionAttributeNames:{'#ttl':'ttl'},ExpressionAttributeValues:{':now':condition.expiresAfter}};
    const entries=Object.entries(condition.equals);
    return {ConditionExpression:entries.map((_,i)=>`#a${i} = :v${i}`).join(' AND '),ExpressionAttributeNames:Object.fromEntries(entries.map(([k],i)=>['#a'+i,k])),ExpressionAttributeValues:Object.fromEntries(entries.map(([,v],i)=>[':v'+i,v]))};
}
export class DynamoStore implements Store {
    constructor(private client=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:3}),{marshallOptions:{removeUndefinedValues:true}})) {}
    async get(table: string, pk: string, sk: string) {return (await this.client.send(new GetCommand({TableName:table,Key:{pk,sk},ConsistentRead:true}))).Item as Item|undefined;}
    async put(table: string, item: Item) {await this.client.send(new PutCommand({TableName:table,Item:item}));}
    async remove(table: string, pk: string, sk: string) {await this.client.send(new DeleteCommand({TableName:table,Key:{pk,sk}}));}
    async consume(table: string, pk: string, sk: string, now: number) {
        try {return (await this.client.send(new DeleteCommand({TableName:table,Key:{pk,sk},ReturnValues:'ALL_OLD',...expression({expiresAfter:now})}))).Attributes as Item|undefined;}
        catch(e) {if((e as Error).name==='ConditionalCheckFailedException')return undefined;throw e;}
    }
    async transaction(writes: Write[]) {
        try {await this.client.send(new TransactWriteCommand({TransactItems:writes.map(w=>'delete' in w?{Delete:{TableName:w.table,Key:w.key,...expression(w.condition)}}:{Put:{TableName:w.table,Item:w.item,...expression(w.condition)}})}));}
        catch(e) {
            const x=e as {name?: string;CancellationReasons?: {Code?: string}[]};
            if(x.name==='TransactionCanceledException' && x.CancellationReasons?.some(r=>r.Code==='ConditionalCheckFailed'))throw new Conflict();
            throw e;
        }
    }
    async list(table: string, partition: string, limit: number, after?: Record<string,unknown>, index=true) {
        const r=await this.client.send(new QueryCommand({TableName:table,...(index?{IndexName:'GSI1'}:{ConsistentRead:true}),KeyConditionExpression:'#pk = :pk',ExpressionAttributeNames:{'#pk':index?'gsi1pk':'pk'},ExpressionAttributeValues:{':pk':partition},Limit:limit,ExclusiveStartKey:after,ScanIndexForward:false}));
        return {items:(r.Items ?? []) as Item[],cursor:r.LastEvaluatedKey};
    }
}
