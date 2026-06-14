# GitHub Integration Setup Guide

## Overview
CodeAutopsy now supports GitHub OAuth login and repository code importing. This guide will help you set up the GitHub OAuth App and configure your environment.

## Prerequisites
- A GitHub account
- The CodeAutopsy project set up and running
- Your server's base URL (e.g., `http://localhost:3000` for local development or your deployed URL)

## Step 1: Create a GitHub OAuth App

### On GitHub:
1. Go to **GitHub Settings** → **Developer Settings** → **OAuth Apps** → **New OAuth App**
   - Or visit: https://github.com/settings/developers

2. **Fill in the OAuth App details:**
   - **Application name**: CodeAutopsy (or your preferred name)
   - **Homepage URL**: `http://localhost:3000` (or your production URL)
   - **Application description**: Code review and analysis tool
   - **Authorization callback URL**: `http://localhost:3000/github-callback.html` 
     - For production, use: `https://yourdomain.com/github-callback.html`

3. Click **Register application**

4. You'll see two important values:
   - **Client ID** - Save this
   - **Client Secret** - Click "Generate" and save this (never share publicly!)

## Step 2: Configure Environment Variables

Create or update your `.env` file in the project root:

```env
# Existing variables
GEMINI_API_KEY=your_gemini_api_key_here

# Add GitHub OAuth variables
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:3000/github-callback.html
```

### For Production:
Replace `http://localhost:3000` with your actual domain:
```env
GITHUB_REDIRECT_URI=https://yourdomain.com/github-callback.html
```

## Step 3: Verify Your Setup

1. **Check that the following files exist:**
   - `server.ts` - Contains GitHub OAuth API endpoints
   - `app.js` - Contains GitHub authentication logic
   - `tool.html` - Contains GitHub import UI
   - `github-callback.html` - Handles OAuth callback
   - `.env` - Contains GitHub credentials

2. **Test the OAuth flow:**
   - Start your server: `npm run dev`
   - Navigate to http://localhost:3000/tool.html
   - Click the "Import from GitHub" button
   - You should be redirected to GitHub's login page
   - After login, you should see your repositories list

## Step 4: Usage

### For End Users:

1. **Sign in with GitHub:**
   - Click "Import from GitHub" button in the CodeAutopsy tool
   - Click "Sign in with GitHub"
   - Authorize the application (one-time)
   - Your session will be saved locally

2. **Browse and Import Code:**
   - Your repositories will appear in a list
   - Search/filter repositories by name
   - Click a repository to browse its files
   - Navigate directories (📁 for folders, 📄 for files)
   - Click any file to load it into the code editor
   - The editor automatically detects the language and loads it
   - The modal closes and you can run Autopsy/Explain

3. **Session Management:**
   - Sessions are stored locally in the browser
   - Sessions expire after 24 hours
   - Use the History feature or browser DevTools to clear if needed

## API Endpoints

### Available GitHub API Endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/github/oauth-url` | GET | Get GitHub OAuth login URL |
| `/api/github/callback` | POST | Handle OAuth callback and exchange code for token |
| `/api/github/repos` | GET | Fetch user's repositories |
| `/api/github/browse` | POST | List files/directories in a repo path |
| `/api/github/file` | POST | Get file contents from a repo |
| `/api/github/logout` | POST | Logout and clear session |

### Required Headers:
```javascript
{
  'x-github-session': 'session_id_from_localStorage'
}
```

## Supported File Types

The importer automatically detects language from file extensions:
- **JavaScript/TypeScript**: .js, .jsx, .ts, .tsx
- **Python**: .py
- **Java**: .java
- **Go**: .go
- **Rust**: .rs
- **C/C++**: .c, .cpp, .h, .hpp
- **Web**: .html, .css, .php
- **Ruby**: .rb
- **Swift**: .swift
- **Kotlin**: .kt
- **C#**: .cs

## Troubleshooting

### Issue: "Missing Gemini API Key"
**Solution**: Ensure `GEMINI_API_KEY` is set in your `.env` file

### Issue: "GitHub OAuth not configured"
**Solution**: Check that `GITHUB_CLIENT_ID` and `GITHUB_REDIRECT_URI` are set in `.env`

### Issue: "OAuth failed" or "Invalid client id"
**Solution**: Verify your Client ID and Secret match your GitHub OAuth App settings

### Issue: "Failed to fetch repositories"
**Possible causes:**
- Session expired (expires after 24 hours)
- GitHub token revoked
- Network/API rate limit

**Solution**: Sign in again

### Issue: File won't load
**Possible causes:**
- File is too large
- Binary file type
- Insufficient permissions

**Solution**: Try a different file or check GitHub permissions

## Security Considerations

1. **Client Secret**: Never expose your `GITHUB_CLIENT_SECRET` in client-side code
   - It's only used on the server in `server.ts`

2. **Token Storage**: 
   - Tokens are stored server-side with a session ID
   - Only the session ID is stored in browser localStorage
   - Sessions expire after 24 hours

3. **Rate Limiting**: GitHub API has rate limits
   - Authenticated requests: 5,000 per hour
   - Be mindful when fetching large repositories

4. **Permissions**: 
   - Users grant `repo` and `user` scope permissions
   - The app can access public and private repositories the user has access to

## Development vs Production

### Local Development:
```env
GITHUB_REDIRECT_URI=http://localhost:3000/github-callback.html
```

### Production Deployment:
```env
GITHUB_REDIRECT_URI=https://yourdomain.com/github-callback.html
```
Update the GitHub OAuth App settings with the same redirect URI.

## Firebase Auth Integration

GitHub OAuth works **alongside** existing Firebase auth:
- Firebase auth for email/password login
- GitHub auth for repository importing
- Both can coexist and are independent

Users can use either authentication method based on their needs.

## Advanced Configuration

### Custom Token Storage
By default, tokens are stored in-memory. For production with multiple instances:
- Replace `githubTokenStore` in `server.ts` with Redis or a database
- Store session ID → token mappings with expiration

### Rate Limiting
Add rate limiting middleware to protect your endpoints:
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/github/', limiter);
```

## Support & Resources

- GitHub OAuth Documentation: https://docs.github.com/en/developers/apps/building-oauth-apps
- GitHub REST API: https://docs.github.com/en/rest
- CodeAutopsy Documentation: See project README

## Next Steps

1. Verify your `.env` file is configured correctly
2. Start the development server
3. Test the GitHub OAuth flow
4. Import code from your repositories
5. Run Code Autopsy or Explainer on imported code
