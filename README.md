# ChimpNews

A viral AI news generator that creates 1-minute news segments hosted by AI chimpanzees.

## Architecture

- **Frontend (Vercel)**: React app for UI and video playback
- **Backend Proxy (Wavespeed)**: Proxy server to handle Wavespeed API requests securely
  - **Option A**: Vercel Serverless Functions (default)
  - **Option B**: Standalone FastAPI backend (Python)
- **Database (Supabase)**: Channel configurations, news items, and video metadata

## Setup

### Frontend Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    Copy `.env.example` to `.env` and fill in the values:
    ```bash
    cp .env.example .env
    ```
    -   `VITE_ADMIN_EMAIL`: The Google email address allowed to login.
    -   `VITE_GEMINI_API_KEY`: Your Google Gemini API Key (for script/audio generation).
    -   `VITE_BACKEND_URL`: Backend API URL (optional, defaults to Vercel proxy).
    -   `VITE_SUPABASE_URL`: Your Supabase Project URL.
    -   `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon Key.
    -   `VITE_GOOGLE_CLIENT_ID`: Your Google Cloud OAuth Client ID.

3.  **Run Locally**:
    ```bash
    npm run dev
    ```

### Backend Setup (Wavespeed Proxy)

You need a backend proxy to handle requests to Wavespeed API (video generation). You have two options:

#### Option 1: Vercel Serverless (Recommended for simple setup)
The project includes Vercel Serverless Functions in `api/`. To use this:
1. Set `WAVESPEED_API_KEY` in your Vercel Project Settings.
2. The frontend will automatically use `/api/wavespeed-proxy` endpoints.

#### Option 2: Standalone Backend (Python/FastAPI)
For more control or if deploying outside Vercel:
1. Navigate to `backend/` folder.
2. Follow instructions in `backend/README.md`.
3. Set `VITE_BACKEND_URL` in your frontend `.env` to point to your backend URL.

See [WAVESPEED_BACKEND_SETUP.md](./WAVESPEED_BACKEND_SETUP.md) for detailed instructions.

### Database (Supabase)

1.  Create a new Supabase project.
2.  Run the SQL scripts (if provided) to set up the `channels`, `news_items`, and `videos` tables.
3.  **IMPORTANT**: Create the `channel-assets` storage bucket:
   - Go to Supabase Dashboard > Storage
   - Click "New bucket"
   - Name: `channel-assets`
   - Set as Public: YES
   - Click "Create bucket"
   - See `supabase_storage_setup.sql` for detailed instructions

### Google Cloud (YouTube)

1.  Create a Project in Google Cloud Console.
2.  Enable the **YouTube Data API v3**.
3.  Configure the OAuth Consent Screen. Add your email as a Test User.
4.  Create OAuth Credentials (Client ID).
5.  Add your Vercel URL (and `http://localhost:5173`) to the **Authorized JavaScript origins** and **Authorized redirect URIs**.

## Features

- **Ovi Video Generation**: Primary video generation with multi-GPU support
- **Gemini VEO 3 Fallback**: Automatic fallback when Ovi is unavailable or quota exceeded
- **Multi-Channel Support**: Manage multiple news channels with different configurations
- **YouTube Integration**: Direct upload to YouTube (via backend proxy to avoid CORS)
- **Date-Based News**: Select specific dates for news scraping
