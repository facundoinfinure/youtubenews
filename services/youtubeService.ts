
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
  thumbnailBlob: Blob | null,
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

    const videoId = await new Promise<string>((resolve, reject) => {
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
            resolve(response.id);
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

    // Upload Thumbnail if provided
    if (thumbnailBlob && videoId) {
      onProgress(100); // Video done, starting thumbnail
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              console.error("Thumbnail upload failed", xhr.responseText);
              // Don't fail the whole process if thumbnail fails, just log it
              resolve();
            }
          };
          xhr.onerror = () => {
            console.error("Network error during thumbnail upload");
            resolve();
          };

          xhr.open("POST", `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`);
          xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
          // Content-Type is automatically set by browser for Blob/File, but for raw bytes we might need it.
          // However, for 'set' endpoint, we send the binary data directly.
          xhr.setRequestHeader("Content-Type", "image/png");
          xhr.send(thumbnailBlob);
        });
      } catch (e) {
        console.error("Thumbnail upload error", e);
      }
    }

    return `https://youtu.be/${videoId}`;

  } catch (error) {
    throw new Error(`YouTube upload error: ${(error as Error).message}`);
  }
};

export const deleteVideoFromYouTube = async (videoId: string, accessToken: string): Promise<void> => {
  try {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status === 204) {
          resolve();
        } else {
          reject(new Error(`Delete failed with status ${xhr.status}: ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during delete."));

      xhr.open("DELETE", `https://www.googleapis.com/youtube/v3/videos?id=${videoId}`);
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.send();
    });
  } catch (error) {
    throw new Error(`YouTube delete error: ${(error as Error).message}`);
  }
};
