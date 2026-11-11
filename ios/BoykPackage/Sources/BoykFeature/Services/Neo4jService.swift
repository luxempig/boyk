import Foundation

enum Neo4jError: LocalizedError {
    case invalidURL
    case requestFailed(Int)
    case decodingFailed(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .requestFailed(let code):
            return "Request failed with status \(code)"
        case .decodingFailed(let error):
            return "Decoding failed: \(error.localizedDescription)"
        case .networkError(let error):
            return error.localizedDescription
        }
    }
}

actor Neo4jService {
    static let shared = Neo4jService()
    private let baseURL = Config.neo4jAPIBase
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        session = URLSession(configuration: config)
    }

    // MARK: - Company Search

    func searchCompanies(query: String, limit: Int = 20) async throws -> [Company] {
        guard query.count >= 2 else { return [] }

        var components = URLComponents(url: baseURL.appendingPathComponent("/api/companies/search"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]

        guard let url = components.url else { throw Neo4jError.invalidURL }
        return try await fetch(url: url)
    }

    // MARK: - Company Details

    func getCompanyWithConnections(id: String) async throws -> CompanyWithConnections? {
        guard isNeo4jID(id) else { return nil }

        let url = baseURL.appendingPathComponent("/api/companies/\(id)")
        do {
            let result: CompanyWithConnections = try await fetch(url: url)
            return result
        } catch Neo4jError.requestFailed(404) {
            return nil // match the sibling lookup methods instead of throwing
        }
    }

    // MARK: - Company Graph

    func getCompanyGraph(id: String, depth: Int = 1) async throws -> GraphData {
        guard isNeo4jID(id) else { return GraphData(nodes: [], links: []) }

        var components = URLComponents(url: baseURL.appendingPathComponent("/api/companies/\(id)/graph"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "depth", value: String(depth)),
        ]

        guard let url = components.url else { throw Neo4jError.invalidURL }
        return try await fetch(url: url)
    }

    // MARK: - Brand Search

    func searchBrands(query: String, limit: Int = 20) async throws -> [Company] {
        guard query.count >= 2 else { return [] }

        var components = URLComponents(url: baseURL.appendingPathComponent("/api/brands/search"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]

        guard let url = components.url else { throw Neo4jError.invalidURL }
        return try await fetch(url: url)
    }

    // MARK: - Brand Details

    func getBrandById(id: String) async throws -> BrandDetail? {
        let url = baseURL.appendingPathComponent("/api/brands/\(id)")
        do {
            let result: BrandDetail = try await fetch(url: url)
            return result
        } catch Neo4jError.requestFailed(404) {
            return nil
        }
    }

    // MARK: - Person Details

    func getPersonById(id: String) async throws -> Person? {
        let url = baseURL.appendingPathComponent("/api/persons/\(id)")
        do {
            let result: Person = try await fetch(url: url)
            return result
        } catch Neo4jError.requestFailed(404) {
            return nil
        }
    }

    // MARK: - Product Barcode Lookup

    /// Returns the full decoded product (name, brand, linked company if any) so
    /// callers can surface what's known even when no parent company is linked.
    /// Returns nil only when the barcode genuinely isn't found (404).
    func lookupProduct(barcode: String) async throws -> ProductLookup? {
        let url = baseURL.appendingPathComponent("/api/products/barcode/\(barcode)")
        do {
            return try await fetch(url: url)
        } catch Neo4jError.requestFailed(404) {
            return nil
        }
    }

    // MARK: - Stats

    func getStats() async throws -> DBStats {
        let url = baseURL.appendingPathComponent("/api/stats")
        return try await fetch(url: url)
    }

    // MARK: - Health

    func checkHealth() async -> Bool {
        let url = baseURL.appendingPathComponent("/api/health")
        do {
            let data = try await session.data(from: url).0
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let status = json["status"] as? String {
                return status == "ok"
            }
            return false
        } catch {
            return false
        }
    }

    // MARK: - Helpers

    private func fetch<T: Decodable>(url: URL) async throws -> T {
        do {
            let (data, response) = try await session.data(from: url)

            if let httpResponse = response as? HTTPURLResponse,
               !(200...299).contains(httpResponse.statusCode) {
                throw Neo4jError.requestFailed(httpResponse.statusCode)
            }

            let decoder = JSONDecoder()
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw Neo4jError.decodingFailed(error)
            }
        } catch let error as Neo4jError {
            throw error
        } catch {
            throw Neo4jError.networkError(error)
        }
    }

    private func isNeo4jID(_ id: String) -> Bool {
        // Wikidata ID: Q followed by digits
        if id.hasPrefix("Q"), id.dropFirst().allSatisfy(\.isNumber) {
            return true
        }
        // LEI: exactly 20 alphanumeric uppercase characters
        if id.count == 20, id.allSatisfy({ $0.isUppercase || $0.isNumber }) {
            return true
        }
        return false
    }
}
