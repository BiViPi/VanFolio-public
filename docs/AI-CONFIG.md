# VanFolio AI Configuration — Bring Your Own Key (BYOK)

VanFolio uses **Bring Your Own Key** (BYOK) model for AI features. You provide your own API credentials, and VanFolio runs the AI inference locally on your machine using those credentials.

**Your API keys are stored securely in Electron Store and never sent to VanFolio servers.**

## Supported Providers

| Provider | Model | Setup |
|----------|-------|-------|
| **Google Gemini** | Gemini 1.5 Pro / Flash | Free tier available |
| **Anthropic Claude** | Claude 3.5 Sonnet / Opus | Paid API only |
| **OpenAI** | GPT-4 / GPT-4 Turbo | Paid API only |

## Setup

### 1. Open AI Settings

In VanFolio:
1. Press **Ctrl+,** (or **Cmd+,** on macOS)
2. Go to **AI Settings** tab

### 2. Choose Provider & Enter Key

#### Google Gemini (Recommended for beginners)

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikeys)
2. Sign in with your Google account
3. Click **Create API key**
4. Copy the key

In VanFolio:
- Select **Provider: Gemini**
- Paste your key
- Click **Save**

**Free tier:** 60 requests/minute, unlimited for dev. No credit card required.

#### Anthropic Claude

1. Visit [Anthropic Console](https://console.anthropic.com/account/keys)
2. Sign in or create an account
3. Click **Create Key**
4. Copy the key

In VanFolio:
- Select **Provider: Anthropic**
- Paste your key
- Click **Save**

**Paid:** Pay-as-you-go, ~$0.003 per 1K input tokens, ~$0.015 per 1K output tokens.

#### OpenAI

1. Visit [OpenAI API Keys](https://platform.openai.com/account/api-keys)
2. Sign in or create an account
3. Click **Create new secret key**
4. Copy the key

In VanFolio:
- Select **Provider: OpenAI**
- Paste your key
- Click **Save**

**Paid:** Pay-as-you-go, pricing varies by model (~$0.03–0.30 per 1K input tokens).

## Using AI Features

Once configured, use AI in the editor by typing:

```
/[command] [prompt]
```

Examples:
- `/improve My paragraph needs better flow` — Rewrite for clarity
- `/expand This is too short` — Add detail
- `/simplify Overly complex text here` — Make more readable
- `/summary Entire chapter text` — Generate summary
- `/outline Topic outline request` — Create outline

**Note:** OpenAI support is in the public codebase but may require additional setup for full integration.

## Security & Privacy

✅ **What VanFolio does:**
- Stores your API key locally in encrypted Electron Store
- Sends your text to the AI provider directly (OpenAI, Google, Anthropic)
- Displays the AI response in the editor

❌ **What VanFolio does NOT do:**
- Log or store your prompts
- Send data to VanFolio servers
- Access your vault without permission
- Track your AI usage

**Your vault files stay on your computer. Only the text you select is sent to the AI provider.**

## Cost Management

### Free Tier (Gemini)

Google Gemini has a free tier:
- **Rate limit:** 60 requests/minute
- **Cost:** $0 for development use
- **Setup:** No credit card required

To stay within free limits:
- Use for occasional editing, not bulk operations
- Avoid repeated requests on large documents
- Monitor usage in [Google AI Studio](https://aistudio.google.com/app/apikeys)

### Paid Tiers (Claude, OpenAI)

Set spending limits:

**Anthropic:**
1. Go to [Billing Settings](https://console.anthropic.com/account/billing/overview)
2. Set **Monthly Budget** to your comfort level
3. Requests are rejected if budget is exceeded

**OpenAI:**
1. Go to [Billing/Usage Limits](https://platform.openai.com/account/billing/limits)
2. Set **Hard limit** to stop requests at a threshold
3. Monitor usage in dashboard

## Switching Providers

To change providers:

1. Open **Settings** → **AI Settings**
2. Select a different provider
3. Enter the new API key
4. Click **Save**

Your old key is replaced. You can store keys for multiple providers if desired by editing settings manually.

## Troubleshooting

### "API key invalid" error

- Verify the key is copied fully (no extra spaces)
- Check that you used the correct provider (Gemini key won't work with Anthropic)
- Verify the key hasn't expired or been revoked
- Some providers require you to enable billing before keys work

### "Rate limit exceeded"

- You've hit the provider's rate limit
- Wait a few seconds and try again
- For high-volume use, upgrade your plan with the provider
- For Gemini, upgrade from free to paid tier

### "Provider not responding"

- Check your internet connection
- Verify the provider's API status page (status.openai.com, etc.)
- Try again in a few moments
- Check VanFolio logs: Help → Show Logs

### AI not appearing in settings

- Restart VanFolio
- Check that you're not running a very old version
- Verify the preload bridge is loaded: Check DevTools (F12) console for errors

## Model Details

### Gemini 1.5 Flash (Recommended)

- **Speed:** Fastest
- **Cost:** Free tier available
- **Context:** 1M tokens
- **Use:** General editing, quick improvements

### Gemini 1.5 Pro

- **Speed:** Slower than Flash
- **Cost:** Free tier available
- **Context:** 1M tokens
- **Use:** Complex analysis, long documents

### Claude 3.5 Sonnet

- **Speed:** Very fast
- **Cost:** ~$3 per 1M input tokens, ~$15 per 1M output tokens
- **Context:** 200K tokens
- **Use:** Production use, quality output

### Claude 3 Opus

- **Speed:** Slower, most capable
- **Cost:** ~$15 per 1M input tokens, ~$75 per 1M output tokens
- **Context:** 200K tokens
- **Use:** Complex reasoning, highest quality

### GPT-4 Turbo

- **Speed:** Fast
- **Cost:** ~$10 per 1M input tokens, ~$30 per 1M output tokens
- **Context:** 128K tokens
- **Use:** High-capability tasks

## FAQ

**Q: Where is my API key stored?**  
A: In Electron Store (local encrypted database), never uploaded to servers.

**Q: Can VanFolio see my vault?**  
A: Only the text you select and send to AI is transmitted.

**Q: What happens if my internet goes down?**  
A: AI features won't work, but you can still edit documents.

**Q: Can I use multiple providers?**  
A: Yes, you can store and switch between providers in settings.

**Q: Is there a default provider?**  
A: No. You must explicitly configure a provider and key.

**Q: What if I forget my API key?**  
A: Regenerate it in the provider's console and update VanFolio settings.

---

**Questions?** Check the [main README](../README.md) or open an issue on GitHub.
