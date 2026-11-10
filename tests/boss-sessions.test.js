const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {registerBossSessions}=require('../lib/boss-sessions');
const {createFixture}=require('./field-fixture');
test('boss sessions survive a server restart, expire after eight hours and revoke on logout or PIN change',async t=>{
  const {db}=await createFixture();t.after(()=>db.close());
  let clock=Date.parse('2026-11-10T00:00:00Z'),pin='1234',failed=false;
  const store={
    get:async h=>{if(failed)throw Error('offline');return (await db.query('select * from boss_sessions where token_hash=$1',[h])).rows[0];},
    put:async r=>db.query('insert into boss_sessions(token_hash,pin_version,expires_at) values($1,$2,$3)',[r.token_hash,r.pin_version,r.expires_at]),
    remove:async h=>db.query('delete from boss_sessions where token_hash=$1',[h]),cleanup:async d=>db.query('delete from boss_sessions where expires_at<=$1',[d])
  };
  const start=async()=>{
    const app=express();app.use(express.json());
    const isBoss=registerBossSessions(app,{store,now:()=>clock,pin:()=>pin,secret:()=>'test-only-server-secret'});
    app.post('/api/private',(q,r)=>r.status(isBoss(q)?200:403).json({ok:isBoss(q)}));
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    return {server,url:`http://127.0.0.1:${server.address().port}`};
  };
  let host=await start();
  const login=async (value=pin)=>fetch(host.url+'/api/boss/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:value})});
  assert.equal((await login('wrong')).status,401);
  const first=await (await login()).json();assert.match(first.token,/^[a-f0-9]{64}$/);
  const stored=(await db.query('select * from boss_sessions')).rows[0];assert.notEqual(stored.token_hash,first.token);assert.notEqual(stored.pin_version,pin);
  const check=token=>fetch(host.url+'/api/private',{method:'POST',headers:{Authorization:`Bearer ${token}`}});
  assert.equal((await check('not-a-token')).status,403);
  await new Promise(resolve=>host.server.close(resolve));host=await start();t.after(()=>new Promise(resolve=>host.server.close(resolve)));
  assert.equal((await check(first.token)).status,200);
  failed=true;assert.equal((await check(first.token)).status,503);failed=false;
  assert.equal((await check(first.token)).status,200);
  clock+=8*60*60*1000;assert.equal((await check(first.token)).status,403);
  const second=await (await login()).json();assert.equal((await check(second.token)).status,200);
  await fetch(host.url+'/api/boss/session',{method:'DELETE',headers:{Authorization:`Bearer ${second.token}`}});
  assert.equal((await check(second.token)).status,403);
  const third=await (await login()).json();pin='4321';assert.equal((await check(third.token)).status,403);
  for(let i=0;i<5;i++)assert.equal((await login('wrong')).status,401);
  assert.equal((await login()).status,429);
  const access=(await db.query("select has_table_privilege('anon','boss_sessions','select') a,has_table_privilege('authenticated','boss_sessions','select') b")).rows[0];
  assert.deepEqual(access,{a:false,b:false});
});
