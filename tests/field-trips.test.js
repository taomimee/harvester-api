const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const { createFixture } = require('./field-fixture');
const { applyAction, summarizeTrip, dayAmounts } = require('../lib/field-trips');
const { registerFieldTrips } = require('../lib/field-trip-routes');

test('daily work posts to existing wages while broker money stays receivable', async t => {
  const fixture = await createFixture();
  const { db, store, vehicles, profiles } = fixture;
  const app = express(); app.use(express.json());
  registerFieldTrips(app, { ...fixture, isBoss: req => req.headers.authorization === 'Bearer test-boss' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tripId = randomUUID(); let current;
  const send = async (action, { id = tripId, revision = current?.revision || 0, request = randomUUID(), auth = true } = {}) => {
    const body = { request_id: request, revision, action };
    const response = await fetch(`${base}/api/field-trips/${id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-boss' } : {}) }, body: JSON.stringify(body) });
    const data = await response.json(); return { status: response.status, data, body };
  };
  const success = async action => { const r = await send(action); assert.equal(r.status, 200, r.data.error); current = r.data; return r; };
  const create = { type: 'CREATE', location: 'ลพบุรี', broker_name: '', start_date: '2026-11-01', vehicle_ids: ['1'], price_per_rai: 600 };
  await t.test('unauthorized writes fail without creating records', async () => {
    assert.equal((await send(create, { auth: false })).status, 403);
    assert.equal((await store.list()).length, 0);
  });
  await success(create);
  const firstDay = { type: 'DAY_SAVE', id: randomUUID(), vehicle_id: '1', work_date: '2026-11-01', plot_count: 4, confirmed_rai: 30, price_per_rai: 600, worker_names: ['สมชาย'], gps_keys: ['1/2026-11-01/plot-1'] };
  const first = await success(firstDay);
  await t.test('4 plots / confirmed 30 rai use broker area, not GPS 35 rai', async () => {
    assert.equal(current.days[0].gps_rai, 35);
    assert.equal(current.summary.rai, 30); assert.equal(current.summary.earned, 18000);
    assert.equal(current.summary.received, 0); assert.equal(current.summary.broker_balance, 18000);
    assert.equal(current.summary.wages, 1800);
    const rows = (await db.query('select * from transactions order by id')).rows;
    assert.equal(rows.length, 2); assert.equal(Number(rows[0].total_amount), 500);
    assert.equal(Number(rows[1].total_amount), 1800); assert.equal(rows[1].status, 'UNPAID');
    assert.equal(rows[1].job_id, null); assert.equal(rows[1].wage_split[0].name, 'สมชาย');
    assert.equal(Number((await db.query("select sum(total_amount) as amount from transactions where category='ค่าแรง'")).rows[0].amount), 2300);
  });
  await t.test('retry after lost response posts one wage and returns the original revision', async () => {
    const r = await send(first.body.action, { revision: first.body.revision, request: first.body.request_id });
    assert.equal(r.status, 200); assert.equal(r.data.revision, first.data.revision);
    assert.equal(Number((await db.query('select count(*) as n from transactions where field_day_id=$1', [firstDay.id])).rows[0].n), 1);
    assert.equal((await send({ ...firstDay, confirmed_rai: 999 }, { revision: first.body.revision, request: first.body.request_id })).status, 409);
  });
  await t.test('worker can withdraw from lifetime wallet before broker pays', async () => {
    await db.query("insert into transactions(type,category,total_amount,paid_amount,status,note,spender_name,transaction_date) values('OUT','เบิกค่าแรง',800,800,'PAID','เบิกเงินสดจากกระเป๋าเงินสะสม','สมชาย',now())");
    const balance = await db.query("select sum(case when category='ค่าแรง' then total_amount when category='เบิกค่าแรง' then -total_amount else 0 end) as balance from transactions");
    assert.equal(Number(balance.rows[0].balance), 1500);
    assert.equal(current.summary.received, 0);
  });
  await t.test('partial and full receipts leave the trip open and do not touch wages', async () => {
    await success({ type: 'PAYMENT_ADD', id: randomUUID(), kind: 'BROKER_RECEIPT', amount: 5000, payment_date: '2026-11-01' });
    assert.equal(current.summary.broker_balance, 13000);
    await success({ type: 'PAYMENT_ADD', id: randomUUID(), kind: 'BROKER_RECEIPT', amount: 13000, payment_date: '2026-11-02' });
    assert.equal(current.status, 'OPEN'); assert.equal(current.summary.broker_balance, 0);
    assert.equal(Number((await db.query('select count(*) as n from transactions')).rows[0].n), 3);
  });
  const secondDay = { ...firstDay, id: randomUUID(), work_date: '2026-11-02', confirmed_rai: 20, plot_count: 3, gps_keys: [], worker_names: ['สมชาย', 'สมปอง'] };
  await t.test('next day adds new receivable and daily wages without reusing customer jobs', async () => {
    await success(secondDay); assert.equal(current.summary.broker_balance, 12000);
    assert.equal(current.days.length, 2); assert.equal(current.summary.wages, 3000);
    assert.deepEqual(current.days[1].crew.map(p => p.amount), [800, 400]);
  });
  await t.test('correcting a day adjusts the existing wage entry, preserving withdrawals', async () => {
    await success({ ...secondDay, confirmed_rai: 25 });
    assert.equal(current.summary.broker_balance, 15000); assert.equal(current.summary.wages, 3300);
    const rows = (await db.query('select * from transactions where field_day_id=$1', [secondDay.id])).rows;
    assert.equal(rows.length, 1); assert.equal(Number(rows[0].total_amount), 1500);
    assert.equal(Number((await db.query("select total_amount from transactions where category='เบิกค่าแรง'")).rows[0].total_amount), 800);
  });
  await t.test('same car/day, invalid areas, missing driver, stale revisions are rejected', async () => {
    for (const bad of [{ ...secondDay, id: randomUUID() }, { ...secondDay, confirmed_rai: -1 }, { ...secondDay, worker_names: ['สมปอง'] }, { ...secondDay, work_date: '2026-02-30' }, { ...secondDay, vehicle_id: '2' }]) {
      assert.ok((await send(bad)).status >= 400);
    }
    assert.equal((await send(secondDay, { revision: 1 })).status, 409);
  });
  await t.test('existing local trigger still runs; changing profiles preserves field-day historical shares', async () => {
    await assert.rejects(db.query("insert into transactions(type,category,total_amount,note) values('OUT','ค่าแรง',1,'คนทำ: ไม่มีชื่อ (พื้นที่ 1 ไร่)')"), /ก่อนบันทึก/);
    await db.query("update wage_workers set role='DRIVER' where name='สมปอง'");
    await success({ ...secondDay, confirmed_rai: 25 });
    const row = (await db.query('select wage_split from transactions where field_day_id=$1', [secondDay.id])).rows[0];
    assert.deepEqual(row.wage_split, current.days[1].crew);
    assert.deepEqual(row.wage_split.map(p => p.rate), [40, 20]);
    await db.query("update wage_workers set role='HELPER' where name='สมปอง'");
  });
  await t.test('concurrent edits cannot silently overwrite another screen', async () => {
    const before = current.revision;
    const results = await Promise.all([send({ ...secondDay, confirmed_rai: 26 }, { revision: before }), send({ ...secondDay, confirmed_rai: 27 }, { revision: before })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    current = results.find(r => r.status === 200).data;
  });
  await t.test('trip, wage entry and audit roll back together on database failure', async () => {
    await db.exec("create function public.test_fail_wage() returns trigger language plpgsql as $$begin if new.total_amount=600000 then raise exception 'SIMULATED_WRITE_FAILURE'; end if; return new; end;$$; create trigger test_fail before insert or update on transactions for each row execute function test_fail_wage();");
    const before = await store.get(tripId);
    const result = await send({ ...secondDay, confirmed_rai: 10000 }); assert.equal(result.status, 503);
    assert.deepEqual(await store.get(tripId), before);
    assert.equal((await db.query('select count(*) as n from field_trip_events where request_id=$1', [result.body.request_id])).rows[0].n, 0);
    await db.exec('drop trigger test_fail on transactions; drop function public.test_fail_wage();');
  });
  await t.test('trip closure is explicit; later broker receipts remain possible', async () => {
    await success({ type: 'CLOSE', end_date: '2026-11-02' }); assert.equal(current.status, 'CLOSED');
    assert.equal((await send({ ...secondDay, work_date: '2026-11-03' })).status, 409);
    await success({ type: 'PAYMENT_ADD', id: randomUUID(), kind: 'BROKER_RECEIPT', amount: current.summary.broker_balance + 500, payment_date: '2026-11-05' });
    assert.equal(current.status, 'CLOSED'); assert.equal(current.summary.broker_balance, -500);
    const lastPayment = current.payments.at(-1);
    await success({ type: 'PAYMENT_VOID', id: lastPayment.id, reason: 'ทดสอบการแก้รายการรับผิด' });
    assert.ok(current.summary.broker_balance > 0); assert.ok(current.payments.at(-1).voided_at);
  });
  await t.test('a new trip can use the same vehicle while the prior trip and receivable stay open', async () => {
    await success({ type: 'REOPEN' });
    const before=await store.get(tripId);
    const wages=(await db.query('select * from transactions order by id')).rows;
    const next=await send({...create,location:'พื้นที่ใหม่'},{id:randomUUID(),revision:0});
    assert.equal(next.status,200,next.data.error);
    assert.equal(next.data.summary.broker_balance,0);
    assert.deepEqual(await store.get(tripId),before);
    assert.deepEqual((await db.query('select * from transactions order by id')).rows,wages);
    // GPS claims remain exclusive across open trips, even for the same vehicle.
    assert.equal((await send({...firstDay,id:randomUUID()}, {id:next.data.id,revision:1})).status,409);
  });
  await t.test('new financial tables and writer are inaccessible to public roles', async () => {
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from field_trips'), /permission denied/);
    await assert.rejects(db.query('select save_field_trip($1,0,$2,$3,$4,$5)', [randomUUID(), {}, randomUUID(), 'a'.repeat(64), 'CREATE']), /permission denied/);
    await db.exec('reset role');
  });
  await t.test('service role can use the writer; legacy routes cannot modify a posted field wage', async () => {
    await db.exec('set role service_role');
    await assert.rejects(db.query('update transactions set total_amount=1 where field_day_id=$1', [firstDay.id]), /ต้องแก้จากยอดรายวัน/);
    await assert.rejects(db.query('delete from transactions where field_day_id=$1', [firstDay.id]), /ต้องแก้จากยอดรายวัน/);
    await success({ type: 'PAYMENT_ADD', id: randomUUID(), kind: 'BROKER_RECEIPT', amount: 100, payment_date: '2026-11-05' });
    await db.exec('reset role');
  });
  await t.test('single vehicle, valid crew, historical shares and cent rounding', () => {
    assert.throws(() => applyAction(null, { ...create, vehicle_ids: ['1','2'] }, { vehicles, profiles }), /หนึ่งคัน/);
    const state = applyAction(null, create, { vehicles, profiles });
    assert.throws(() => applyAction(state, { type: 'PAYMENT_ADD', id: randomUUID(), kind: 'WORKER_PAYMENT' }, { profiles }), /สมุดค่าแรงเดิม/);
    const split = dayAmounts(0.3333, 600, [{ name: 'a', role: 'DRIVER', rate: 30 }, { name: 'b', role: 'DRIVER', rate: 30 }]);
    assert.equal(split.crew.reduce((s, p) => s + p.amount, 0), split.wage_amount);
    assert.equal(summarizeTrip(state).received, 0);
    assert.throws(() => applyAction(state, { type:'PAYMENT_ADD',id:randomUUID(),kind:'BROKER_RECEIPT',payment_date:'2026-11-01',amount:0.0001 }, {profiles}), /0.01/);
  });
});

test('monthly report allocates receipts without counting wages twice', async () => {
  const { fieldTripPeriodStats } = await import('../harvester-app/src/field-trip-reports.mjs');
  const trips = [{ days: [{work_date:'2026-10-31',confirmed_rai:10,plot_count:1,harvest_amount:6000}, {work_date:'2026-11-01',confirmed_rai:30,plot_count:4,harvest_amount:18000}], payments: [{payment_date:'2026-11-02',amount:10000}, {payment_date:'2026-11-03',amount:999,voided_at:'void'}] }];
  assert.deepEqual(fieldTripPeriodStats(trips,2026,11), {rai:30,plots:4,earned:18000,received:10000,outstanding:14000,days:1,wages:0});
});
