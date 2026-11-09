'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { analyzeGpsDay } = require('./gps-auto');
try { parentPort.postMessage({result:analyzeGpsDay(workerData.rows,workerData.options)}); }
catch(error) { parentPort.postMessage({error:error.message}); }
