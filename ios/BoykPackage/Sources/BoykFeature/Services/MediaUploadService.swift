import Foundation
import Supabase
import UIKit

enum MediaUploadError: LocalizedError {
    case invalidResponse
    case presignFailed(Int, String?)
    case uploadFailed(Int)
    case tooLarge(bytes: Int, max: Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The upload service returned an unexpected response."
        case .presignFailed(_, let message?):
            return message
        case .presignFailed(let code, nil):
            return "Could not start the upload (status \(code))."
        case .uploadFailed(let code):
            return "Upload failed with status \(code)."
        case .tooLarge(let bytes, let max):
            let mb = Double(bytes) / 1_048_576
            let maxMB = max / 1_048_576
            return String(format: "Image is too large (%.1f MB). Maximum is %d MB.", mb, maxMB)
        }
    }
}

/// Uploads images to Cloudflare R2 through the `upload-url` Supabase edge function.
///
/// Mirrors the web flow in `src/lib/s3.js`: ask the edge function for a presigned
/// PUT URL, then send the bytes straight to R2.
///
/// Supabase Storage is deliberately not used — this project has **no** storage
/// buckets provisioned; every binary asset lives in the `boyk-assets` R2 bucket.
actor MediaUploadService {
    static let shared = MediaUploadService()

    /// Mirrors `MAX_UPLOAD_BYTES` in `supabase/functions/upload-url/index.ts`.
    /// The edge function signs the byte count into the presigned URL, so the PUT
    /// body length must match `contentLength` exactly — R2 rejects any mismatch.
    static let maxUploadBytes = 10 * 1024 * 1024

    /// Determines the R2 key prefix the edge function assigns
    /// (`profile-pictures/`, `post-media/`, `comment-media/`).
    ///
    /// Note: the edge function builds the full key itself as
    /// `<prefix>/<userID>-<timestamp>.<ext>` and uses `fileName` only for its
    /// extension — so every upload creates a new object rather than overwriting.
    enum Purpose: String {
        case profile
        case post
        case comment
    }

    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        // Uploads carry real payloads, so they need a longer leash than the
        // 15s used for JSON API calls in Neo4jService.
        config.timeoutIntervalForRequest = 60
        session = URLSession(configuration: config)
    }

    /// Uploads image bytes and returns the public URL to store on the profile/post.
    func upload(
        imageData: Data,
        fileName: String,
        contentType: String = "image/jpeg",
        purpose: Purpose
    ) async throws -> String {
        guard imageData.count <= Self.maxUploadBytes else {
            throw MediaUploadError.tooLarge(bytes: imageData.count, max: Self.maxUploadBytes)
        }

        let presigned = try await requestPresignedURL(
            fileName: fileName,
            contentType: contentType,
            contentLength: imageData.count,
            purpose: purpose
        )

        try await putToR2(presigned.uploadUrl, data: imageData, contentType: contentType)

        return presigned.publicUrl
    }

    // MARK: - Steps

    private func requestPresignedURL(
        fileName: String,
        contentType: String,
        contentLength: Int,
        purpose: Purpose
    ) async throws -> PresignResponse {
        let token = try await supabase.auth.session.accessToken

        var request = URLRequest(url: Config.supabaseURL.appendingPathComponent("functions/v1/upload-url"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try JSONEncoder().encode(
            PresignRequest(
                fileName: fileName,
                contentType: contentType,
                contentLength: contentLength,
                purpose: purpose.rawValue
            )
        )

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw MediaUploadError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = try? JSONDecoder().decode(ErrorBody.self, from: data).error
            throw MediaUploadError.presignFailed(http.statusCode, message)
        }

        do {
            return try JSONDecoder().decode(PresignResponse.self, from: data)
        } catch {
            throw MediaUploadError.invalidResponse
        }
    }

    private func putToR2(_ urlString: String, data: Data, contentType: String) async throws {
        guard let url = URL(string: urlString) else {
            throw MediaUploadError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        let (_, response) = try await session.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse else {
            throw MediaUploadError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw MediaUploadError.uploadFailed(http.statusCode)
        }
    }

    // MARK: - Wire types

    private struct PresignRequest: Encodable {
        let fileName: String
        let contentType: String
        let contentLength: Int
        let purpose: String
    }

    private struct PresignResponse: Decodable {
        let uploadUrl: String
        let publicUrl: String
    }

    private struct ErrorBody: Decodable {
        let error: String
    }
}

extension UIImage {
    /// Scales the image down so its longest side is at most `maxDimension`
    /// pixels, preserving aspect ratio. Returns the image unchanged when it is
    /// already small enough.
    func resizedToFit(maxDimension: CGFloat) -> UIImage {
        let pixelSize = CGSize(width: size.width * scale, height: size.height * scale)
        let largestSide = max(pixelSize.width, pixelSize.height)
        guard largestSide > maxDimension else { return self }

        let ratio = maxDimension / largestSide
        let newSize = CGSize(width: pixelSize.width * ratio, height: pixelSize.height * ratio)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
