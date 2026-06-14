# Quick Start Guide - GitHub Integration

## TL;DR - Get Running in 5 Minutes

### 1. Create GitHub OAuth App (2 minutes)
```
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill form:
   - Name: CodeAutopsy
   - Homepage: http://localhost:3000
   - Callback: http://localhost:3000/github-callback.html
4. Copy Client ID and Client Secret
```

### 2. Configure Environment (1 minute)
```bash
# Create/update .env file in project root
GITHUB_CLIENT_ID=your_id_here
GITHUB_CLIENT_SECRET=your_secret_here
GITHUB_REDIRECT_URI=http://localhost:3000/github-callback.html
```

### 3. Start Server (1 minute)
```bash
npm run dev
# Server runs at http://localhost:3000
```

### 4. Test (1 minute)
1. Open http://localhost:3000/tool.html
2. Click "Import from GitHub"
3. Sign in with GitHub
4. Pick a file from your repo
5. Code loads into editor ✅

---

## Files to Know About

| File | Purpose |
|------|---------|
| `server.ts` | 6 new GitHub API endpoints |
| `app.js` | OAuth flow + file browser logic |
| `tool.html` | Import button + modal UI |
| `github-callback.html` | OAuth callback handler |
| `style.css` | Modal styles + animations |
| `.env` | Your credentials (keep secret!) |
| `GITHUB_SETUP.md` | Detailed setup guide |
| `IMPLEMENTATION_SUMMARY.md` | Complete feature overview |

---

## Common Issues & Fixes

### Error: "GitHub OAuth not configured"
```
❌ Problem: Missing env variables
✅ Fix: Check GITHUB_CLIENT_ID in .env
```

### Error: "Invalid client id"
```
❌ Problem: Wrong Client ID
✅ Fix: Copy exact ID from GitHub settings
```

### Auth popup doesn't work
```
❌ Problem: Popup blocked by browser
✅ Fix: Allow popups or test in incognito mode
```

### Session expired
```
❌ Problem: Trying to use session after 24 hours
✅ Fix: Sign in again to get new session
```

---

## Code Snippets

### Load a File into Editor
```javascript
// This happens automatically when you click a file in the modal
codeArea.value = content;
updateLineNumbers();
document.getElementById('language-select').value = 'javascript';
```

### Manual GitHub API Call
```javascript
// From your code:
const response = await fetch('/api/github/repos', {
  headers: { 'x-github-session': sessionId }
});
const repos = await response.json();
```

---

## Key Features

✨ **What You Get:**
- ✅ Sign in with GitHub
- ✅ List your repositories  
- ✅ Browse files in repos
- ✅ One-click import code
- ✅ Auto language detection
- ✅ Run Autopsy on imported code

---

## Production Checklist

- [ ] Update GitHub OAuth redirect URL to your domain
- [ ] Update `GITHUB_REDIRECT_URI` in `.env`
- [ ] Use environment secrets (never commit credentials)
- [ ] Test OAuth flow end-to-end
- [ ] Monitor GitHub API rate limits
- [ ] Consider Redis for token storage
- [ ] Add request rate limiting

---

## Next Steps

1. **Quick Start**: Follow steps 1-4 above
2. **Learn More**: Read [GITHUB_SETUP.md](GITHUB_SETUP.md)
3. **Deep Dive**: Check [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
4. **Deploy**: Update credentials and deploy

---

## Need Help?

See **GITHUB_SETUP.md** for:
- Detailed troubleshooting
- Advanced configuration
- Production deployment guide
- API endpoint documentation

---

**Status**: Ready to use 🚀
