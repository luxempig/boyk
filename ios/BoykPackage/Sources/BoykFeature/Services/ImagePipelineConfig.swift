import Foundation
import Nuke

public enum ImagePipelineConfig {
    public static func configure() {
        let dataCache = try? DataCache(name: "org.boyk.image-cache")
        dataCache?.sizeLimit = 200 * 1024 * 1024  // 200 MB — fits ~2k R2 logos

        let imageCache = ImageCache()
        imageCache.costLimit = 50 * 1024 * 1024   // 50 MB in-memory cap
        imageCache.countLimit = 200

        let pipeline = ImagePipeline {
            $0.dataCache = dataCache
            $0.imageCache = imageCache
            $0.isProgressiveDecodingEnabled = false
            $0.isDecompressionEnabled = true
        }
        ImagePipeline.shared = pipeline
    }
}
