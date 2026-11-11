import Foundation

@MainActor
class CompanyViewModel: ObservableObject {
    enum ViewState {
        case idle
        case loading
        case loaded(CompanyWithConnections)
        case notFound
        case error(String)
    }

    @Published var state: ViewState = .idle
    @Published var graphData: GraphData?

    func load(companyID: String) async {
        state = .loading
        do {
            async let companyResult = Neo4jService.shared.getCompanyWithConnections(id: companyID)
            async let graphResult = Neo4jService.shared.getCompanyGraph(id: companyID, depth: 1)

            let (company, graph) = try await (companyResult, graphResult)

            if let company {
                state = .loaded(company)
                graphData = graph
            } else {
                state = .notFound
            }
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
