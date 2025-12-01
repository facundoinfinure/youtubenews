# ChimpNews

A viral AI news generator that creates 1-minute news segments hosted by AI chimpanzees.

## Setup

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
    -   `VITE_GEMINI_API_KEY`: Your Google Gemini API Key.
    -   `VITE_SUPABASE_URL`: Your Supabase Project URL.
    -   `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon Key.
    -   `VITE_GOOGLE_CLIENT_ID`: Your Google Cloud OAuth Client ID.

3.  **Run Locally**:
    ```bash
    npm run dev
    ```

## Deployment

### Vercel

1.  Push your code to a GitHub repository.
2.  Import the project into Vercel.
3.  In the Vercel Project Settings, go to **Environment Variables**.
4.  Add all the variables from your `.env` file.
5.  Deploy!

### Supabase

1.  Create a new Supabase project.
2.  Run the SQL scripts (if provided) to set up the `channel_settings` and `videos` tables.

### Google Cloud (YouTube)

1.  Create a Project in Google Cloud Console.
2.  Enable the **YouTube Data API v3**.
3.  Configure the OAuth Consent Screen. Add your email as a Test User.
4.  Create OAuth Credentials (Client ID).
5.  Add your Vercel URL (and `http://localhost:5173`) to the **Authorized JavaScript origins** and **Authorized redirect URIs**.
