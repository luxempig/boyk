import SwiftUI

struct SearchBar: View {
    @Binding var text: String
    var placeholder: String = "Search..."

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.textMuted)
                .font(.system(size: 14))
                .accessibilityHidden(true)

            TextField(placeholder, text: $text)
                .foregroundColor(.textPrimary)
                .autocapitalization(.none)
                .disableAutocorrection(true)

            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.textMuted)
                        .font(.system(size: 14))
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(14)
        .background(Color.bgCard)
        .overlay(
            Rectangle()
                .stroke(Color.border, lineWidth: 1)
        )
    }
}
