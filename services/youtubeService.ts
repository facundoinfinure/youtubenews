
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

export const uploadVideoToYouTube = async (
  blob: Blob,
  metadata: ViralMetadata,
  accessToken: string,
  onProgress: (percent: number) => void
): Promise<string> => {
  try {
    const metadataObj = {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: "25", // News & Politics
      },
      status: {
        privacyStatus: "private", // Default to private for safety
      },
    };

    const formData = new FormData();
    formData.append(
      "snippet",
      new Blob([JSON.stringify(metadataObj)], { type: "application/json" })
    );
    formData.append("file", blob, "video.mp4");

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
            const videoId = response.id;
            resolve(`https://youtu.be/${videoId}`);
          } catch (e) {
            reject(new Error("Failed to parse YouTube response"));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload."));

      xhr.open(
        "POST",
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status"
      );
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.send(formData);
    });
  } catch (error) {
    throw new Error(`YouTube upload error: ${(error as Error).message}`);
  }
};
