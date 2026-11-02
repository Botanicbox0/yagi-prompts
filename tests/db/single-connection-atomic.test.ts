import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { makeSingleConnectionRunner } from '@/lib/db/sql-runner';

describe('local single connection matches pinned Postgres transactions',()=>{
  it('rolls back both outer and nested writes after a later failure',async()=>{
    const db=new PGlite();
    try{
      await db.exec('create table records(value integer not null)');
      const sql=makeSingleConnectionRunner(async<T>(text:string,params:unknown[]=[])=>({rows:(await db.query<T>(text,params as never[])).rows}));
      await expect(sql.transaction(async tx=>{
        await tx.query('insert into records values(1)');
        await tx.transaction(async inner=>{await inner.query('insert into records values(2)');});
        throw new Error('later enqueue failed');
      })).rejects.toThrow('later enqueue failed');
      expect((await sql.query('select * from records')).rows).toEqual([]);
    }finally{await db.close();}
  });
});
