'use strict';
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const tokenOf = req => String(req.headers.authorization || '').replace(/^Bearer /, '');
const unwrap = result => { if (result.error) throw result.error; return result.data; };
function bossSessionStore(db) {
  return {
    get: async key => unwrap(await db.from('boss_sessions').select('expires_at,pin_version').eq('token_hash',key).maybeSingle()),
    put: async row => unwrap(await db.from('boss_sessions').insert(row)),
    remove: async key => unwrap(await db.from('boss_sessions').delete().eq('token_hash',key)),
    cleanup: async date => unwrap(await db.from('boss_sessions').delete().lte('expires_at',date))
  };
}
function registerBossSessions(app, {store, pin=()=>process.env.BOSS_PIN, secret=()=>process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY, now=Date.now}) {
  const attempts = new Map();
  // A PIN change invalidates sessions, without storing the PIN or raw bearer token.
  const version = () => crypto.createHmac('sha256',secret()).update(pin()).digest('hex');
  app.use('/api', async (req,res,next) => {
    req.bossAuthenticated=false;
    const token=tokenOf(req);
    if (!/^[a-f0-9]{64}$/.test(token) || !pin() || !secret()) return next();
    try {
      const session=await store.get(hash(token));
      req.bossAuthenticated=!!session && Date.parse(session.expires_at)>now() && session.pin_version===version();
      next();
    } catch { res.status(503).json({error:'ตรวจสิทธิ์ไม่สำเร็จชั่วคราว กรุณาลองอีกครั้ง ข้อมูลที่กรอกยังอยู่'}); }
  });
  app.get('/api/boss/session',(req,res)=>res.status(req.bossAuthenticated?200:401).set('Cache-Control','no-store').json({authenticated:req.bossAuthenticated}));
  app.post('/api/boss/session',async(req,res)=>{
    if(!pin() || !secret()) return res.status(503).json({error:'โหมดเถ้าแก่ยังไม่พร้อม กรุณาตรวจการตั้งค่าเซิร์ฟเวอร์'});
    for(const [key,value] of attempts) if(value.until<=now())attempts.delete(key);
    const key=req.ip, attempt=attempts.get(key)||{count:0,until:now()+15*60*1000};
    if(attempt.count>=5)return res.status(429).json({error:'ใส่รหัสผิดหลายครั้ง กรุณารอ 15 นาที'});
    if(!crypto.timingSafeEqual(Buffer.from(hash(String(req.body?.pin||''))),Buffer.from(hash(pin())))) {
      attempt.count++;attempts.set(key,attempt);return res.status(401).json({error:'รหัสเถ้าแก่ไม่ถูกต้อง'});
    }
    try {
      const token=crypto.randomBytes(32).toString('hex'),expires_at=new Date(now()+8*60*60*1000).toISOString();
      await store.put({token_hash:hash(token),pin_version:version(),expires_at});
      attempts.delete(key);
      store.cleanup(new Date(now()).toISOString()).catch(()=>{});
      res.set('Cache-Control','no-store').json({token,expires_at});
    } catch {res.status(503).json({error:'ยังบันทึกสิทธิ์ไม่ได้ กรุณาลองอีกครั้ง'});}
  });
  app.delete('/api/boss/session',async(req,res)=>{
    try {await store.remove(hash(tokenOf(req)));res.json({success:true});}
    catch {res.status(503).json({error:'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง'});}
  });
  return req=>req.bossAuthenticated===true;
}
module.exports={bossSessionStore,registerBossSessions};
