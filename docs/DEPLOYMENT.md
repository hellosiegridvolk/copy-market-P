# DEPLOYMENT

## Baseline deploy
1. `npm ci`
2. `npm run build`
3. Configure `.env`
4. `npm start`

## Important truthfulness notes
- Persistence backend is NeDB local files.
- Ensure `DB_DIR` is writable and backed up.
- Default API/UI port: `3000` unless `PORT` is set.
- Use preview mode first in new environments.
