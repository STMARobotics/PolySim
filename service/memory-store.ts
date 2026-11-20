// Local-only adapter and deterministic test double. Deployed handlers always use DynamoStore.
import { canonical } from './http';
import { Conflict, type Store, type Item, type Write, type Condition } from './store';
export class MemoryStore implements Store {
    readonly rows=new Map<string,Item>();
    private key(table:string,pk:string,sk:string) {return [table,pk,sk].join('\0');}
    async get(table:string,pk:string,sk:string) {const v=this.rows.get(this.key(table,pk,sk));return v?structuredClone(v):undefined;}
    async put(table:string,item:Item) {this.rows.set(this.key(table,item.pk,item.sk),structuredClone(item));}
    async remove(table:string,pk:string,sk:string) {this.rows.delete(this.key(table,pk,sk));}
    async consume(table:string,pk:string,sk:string,now:number) {
        const key=this.key(table,pk,sk),v=this.rows.get(key);
        if(!v || v.ttl<=now)return undefined;
        this.rows.delete(key);return structuredClone(v);
    }
    private check(row:Item|undefined,condition?:Condition) {
        if(!condition)return true;
        if('absent' in condition)return !row;
        if('expiresAfter' in condition)return !!row && row.ttl>condition.expiresAfter;
        return !!row && Object.entries(condition.equals).every(([k,v])=>canonical(row[k])===canonical(v));
    }
    async transaction(writes:Write[]) {
        // Check and commit without awaits: competing transactions cannot interleave.
        for(const w of writes) {const key='delete' in w?w.key:w.item;if(!this.check(this.rows.get(this.key(w.table,key.pk,key.sk)),w.condition))throw new Conflict();}
        for(const w of writes)if('delete' in w)this.rows.delete(this.key(w.table,w.key.pk,w.key.sk));else this.rows.set(this.key(w.table,w.item.pk,w.item.sk),structuredClone(w.item));
    }
    async list(table:string,partition:string,limit:number,after?:Record<string,unknown>,index=true) {
        const rows=[...this.rows.entries()].filter(([k,v])=>k.startsWith(table+'\0') && (index?v.gsi1pk:v.pk)===partition).map(([,v])=>v).sort((a,b)=>String(index?b.gsi1sk:b.sk).localeCompare(String(index?a.gsi1sk:a.sk)));
        const start=after?rows.findIndex(v=>v.pk===after.pk && v.sk===after.sk)+1:0,items=rows.slice(start,start+limit),last=items.at(-1);
        return {items:structuredClone(items),...(last && start+limit<rows.length?{cursor:index?{pk:last.pk,sk:last.sk,gsi1pk:last.gsi1pk,gsi1sk:last.gsi1sk}:{pk:last.pk,sk:last.sk}}:{})};
    }
}
