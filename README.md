# ChimpNews

A viral AI news generator that creates 1-minute news segments hosted by AI chimpanzees.

## Architecture

- **Frontend (Vercel)**: React app for UI and video playback
- **Backend (GCP)**: FastAPI service with Ovi (primary) and Gemini VEO 3 (fallback) for video generation
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
    -   `VITE_BACKEND_URL`: Backend API URL (e.g., `http://localhost:8080` or your GCP instance URL).
    -   `VITE_SUPABASE_URL`: Your Supabase Project URL.
    -   `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon Key.
    -   `VITE_GOOGLE_CLIENT_ID`: Your Google Cloud OAuth Client ID.

3.  **Run Locally**:
    ```bash
    npm run dev
    ```

### Backend Setup

See [backend/README.md](./backend/README.md) for detailed backend setup instructions.

Quick start:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

## Deployment

### Frontend (Vercel)

1.  Push your code to a GitHub repository.
2.  Import the project into Vercel.
3.  In the Vercel Project Settings, go to **Environment Variables**.
4.  Add all the variables from your `.env` file, including `VITE_BACKEND_URL`.
5.  Deploy!

### Backend (Google Cloud Platform)

**Option 1: Compute Engine with GPU (Recommended for Ovi)**

For production with GPU support and Ovi:

```bash
cd backend
chmod +x deploy-gcp.sh
export GCP_PROJECT_ID=your-project-id
export GEMINI_API_KEY=your-key
./deploy-gcp.sh
```

**Option 2: Cloud Run (Serverless, Gemini Only)**

For serverless deployment without GPU:

```bash
cd backend
chmod +x deploy-cloud-run.sh
export GCP_PROJECT_ID=your-project-id
export GEMINI_API_KEY=your-key
./deploy-cloud-run.sh
```

See [backend/README.md](./backend/README.md) for detailed deployment instructions.

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
