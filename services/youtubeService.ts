
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

// Login handled via Supabase Auth now

const getBackendUrl = () => {
  return (
    import.meta.env.VITE_BACKEND_URL ||
    window.env?.BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:8080"
  );
};

export const uploadVideoToYouTube = async (
  blob: Blob,
  metadata: ViralMetadata,
  accessToken: string,
  onProgress: (percent: number) => void
): Promise<string> => {
  const backendUrl = getBackendUrl();

  try {
    // Use backend proxy to avoid CORS issues
    const formData = new FormData();
    formData.append("file", blob, "video.webm");
    formData.append("metadata", JSON.stringify({
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: "25", // News & Politics
      privacyStatus: "private",
    }));
    formData.append("access_token", accessToken);

    // Create XMLHttpRequest for progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success && response.video_url) {
              resolve(response.video_url);
            } else {
              reject(new Error(response.error || "Upload failed"));
            }
          } catch (e) {
            reject(new Error("Failed to parse response"));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload."));

      xhr.open("POST", `${backendUrl}/api/v1/youtube/upload`);
      xhr.send(formData);
    });
  } catch (error) {
    throw new Error(`YouTube upload error: ${(error as Error).message}`);
  }
};
