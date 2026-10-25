import { writeLab } from '../src/lab/gen.js';

const result = await writeLab({ root: process.cwd(), seed: Number(process.env.LAB_SEED || 42) });
console.log('lab: ' + result.scenarios + ' scenarios, ' + result.images + ' images');
