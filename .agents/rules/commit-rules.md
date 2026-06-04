---
trigger: always
---
## Development and Commit Workflow Rules

- **No commits without local testing and approval:** Under no circumstances should you run `git commit`, `git commit --amend`, or create any commit until you have started the local development server (`firebase emulators:start --only hosting`), verified the visual layout changes, and received explicit user approval.
- **No Push/Deploy without approval:** Do not run `git push` or `firebase deploy` unless the user has explicitly requested or approved it.
