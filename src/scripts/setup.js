#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), '.env');
const examplePath = path.join(process.cwd(), '.env.example');

if (fs.existsSync(envPath)) {
  console.log('.env already exists. No changes made.');
  console.log('Compare it with .env.example if you want the latest starter defaults.');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('.env.example not found. Cannot bootstrap configuration.');
  process.exit(1);
}

fs.copyFileSync(examplePath, envPath);
console.log('Created .env from .env.example');
console.log('Start with PREVIEW_MODE=true and edit .env before running validation.');
console.log('PRIVATE_KEY can stay blank in preview mode.');
console.log('Add a real PRIVATE_KEY only when you are ready to switch to live mode.');
