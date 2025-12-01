
import { UserProfile, ViralMetadata } from "../types";

// =============================================================================================
// CONFIGURATION: GOOGLE CLOUD OAUTH CLIENT ID
// =============================================================================================

// Priority: 
// 1. Runtime Environment (Cloud Run - window.env)
// 2. Build-time Environment (Vite - process.env)
const getClientId = () => {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || window.env?.googlecloud_clientid || process.env.googlecloud_clientid || process.env.GOOGLE_CLIENT_ID;
}

const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";

export const initGoogleLogin = (onSuccess: (user: UserProfile) => void, onError: (err: string) => void) => {
  if (!window.google) {
    onError("Google Identity Services script not loaded.");
    return null;
  }

  const CLIENT_ID = getClientId();

  console.log("Initializing Login with ClientID:", CLIENT_ID);

  if (!CLIENT_ID) {
    onError("Missing Google Client ID. Please check Cloud Run environment variables (googlecloud_clientid).");
    return null;
  }

  const tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (tokenResponse: any) => {
      if (tokenResponse.error) {
        console.error("OAuth Error Response:", tokenResponse);
        onError(`OAuth Error: ${tokenResponse.error} - ${tokenResponse.error_description || ''}`);
        return;
      }

      if (tokenResponse.access_token) {
        try {
          // Fetch user profile to verify email
          const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
          });
          const userInfo = await userInfoRes.json();

          onSuccess({
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            accessToken: tokenResponse.access_token
          });
        } catch (e) {
          onError("Failed to fetch user profile.");
        }
      }
    },
  });

  return tokenClient;
};

export const uploadVideoToYouTube = async (
  blob: Blob,
  metadata: ViralMetadata,
  accessToken: string,
  onProgress: (percent: number) => void
): Promise<string> => {

  // 1. Initiate Resumable Upload
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Length": blob.size.toString(),
        "X-Upload-Content-Type": "video/webm",
      },
      body: JSON.stringify({
        snippet: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          categoryId: "25", // News & Politics
        },
        status: {
          privacyStatus: "private", // Default to private for safety
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Upload initiation failed: ${err}`);
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("No upload URL received from YouTube.");

  // 2. Upload the file
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", "video/webm");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const response = JSON.parse(xhr.responseText);
        resolve(`https://youtu.be/${response.id}`);
      } else {
        reject(`Upload failed with status ${xhr.status}`);
      }
    };

    xhr.onerror = () => reject("Network error during upload.");
    xhr.send(blob);
  });
};
