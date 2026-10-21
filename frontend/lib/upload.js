import { ApiError } from "@/lib/api";

/**
 * Sends files straight to the backend's one-time upload address (large files must not pass through
 * this app's server: spec §8.12). Reports progress as 0..1. Resolves with the validation report.
 */
export function uploadFiles(uploadUrl, files, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: handled below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve(body);
      } else {
        reject(new ApiError(body?.detail ?? `The upload failed (error ${xhr.status}).`, { status: xhr.status, code: body?.code ?? "upload_failed" }));
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          "Could not reach the upload address. Check that the backend is running, and that its SMARTSTOCK_CORS_ORIGINS setting includes this site's address.",
          { code: "upload_unreachable" },
        ),
      );
    xhr.send(form);
  });
}
