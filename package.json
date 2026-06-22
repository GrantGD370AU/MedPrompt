{
  "name": "medprompt",
  "version": "0.1.0",
  "private": true,
  "description": "AI-augmented teleprompter for healthcare communication training.",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:create": "wrangler d1 create medprompt",
    "db:init": "wrangler d1 execute medprompt --remote --file=./schema.sql",
    "db:init:local": "wrangler d1 execute medprompt --local --file=./schema.sql"
  },
  "devDependencies": {
    "wrangler": "^3.90.0"
  }
}
