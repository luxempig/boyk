import Foundation
import Testing
@testable import BoykFeature

@Test func example() async throws {
    // Write your test here and use APIs like `#expect(...)` to check expected conditions.
}

/// The Worker's Open Food Facts fallback (public/_worker.js) marks its answers
/// with `source`; the scan screen keys the ODbL attribution off it.
@Test func productLookupDecodesOpenFoodFactsSource() throws {
    let json = """
    {"barcode":"3017620422003","name":"Nutella","brand_name":"Ferrero",
     "brand_id":null,"company_id":"Q690814","company_name":"Ferrero",
     "source":"openfoodfacts","license":"ODbL",
     "attribution":{"name":"Open Food Facts","url":"https://world.openfoodfacts.org"}}
    """
    let product = try JSONDecoder().decode(ProductLookup.self, from: Data(json.utf8))
    #expect(product.source == "openfoodfacts")
    #expect(product.companyName == "Ferrero")
}

@Test func productLookupFromGraphHasNoSource() throws {
    let json = #"{"barcode":"0001","name":"Widget","company_id":"LEI1","company_name":"Acme"}"#
    let product = try JSONDecoder().decode(ProductLookup.self, from: Data(json.utf8))
    #expect(product.source == nil)
}
