#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), '.env');
const examplePath = path.join(process.cwd(), '.env.example');

if (fs.existsSync(envPath)) {
  console.log('✅ .env already exists. No changes made.');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('❌ .env.example not found. Cannot bootstrap configuration.');
  process.exit(1);
}

fs.copyFileSync(examplePath, envPath);
console.log('✅ Created .env from .env.example');
console.log('ℹ️ Edit .env with your real wallet keys before running the bot.');
