# Server

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Update `.env` with your credentials.

## Database Seeding

To seed the database with test users and sample data:

```bash
export GOOGLE_CLOUD_PROJECT=<ProjectID> && npx tsx scripts/seed.ts --clean --force
```

**Options:**
- `--clean` - Delete existing data before seeding
- `--force` - Skip confirmation prompts

**Test Accounts:**

| Username | Password | Role |
|----------|----------|------|
| dr_smith | doctor123 | Doctor |
| dr_chen | doctor123 | Doctor |
| dr_tanaka | doctor123 | Doctor |
| dr_wong | doctor123 | Doctor |
| patient_aung | patient123 | Patient |
| patient_thida | patient123 | Patient |
| patient_zaw | patient123 | Patient |
| patient_hla | patient123 | Patient |
| patient_kyaw | patient123 | Patient |
| admin | admin123 | Admin |

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm start
```
