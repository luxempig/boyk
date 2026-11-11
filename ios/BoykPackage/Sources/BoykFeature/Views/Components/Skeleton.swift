import SwiftUI

/// Animated shimmer placeholder. Compose at the call site to mirror the
/// shape of the real content (post cards, list rows, etc.) so users see
/// the layout before data arrives — feels significantly faster than a spinner.
struct Skeleton: View {
    var cornerRadius: CGFloat = 4

    @State private var phase: CGFloat = -1

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius)
                .fill(Color.bgCard)

            GeometryReader { geo in
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.0),
                                Color.white.opacity(0.06),
                                Color.white.opacity(0.0),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geo.size.width * 0.5)
                    .offset(x: phase * geo.size.width * 1.5)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        }
        .onAppear {
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                phase = 1
            }
        }
        .accessibilityHidden(true)
    }
}

/// Post-card-shaped skeleton block.
struct PostSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Skeleton(cornerRadius: 18).frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 4) {
                    Skeleton().frame(width: 120, height: 12)
                    Skeleton().frame(width: 80, height: 10)
                }
            }
            Skeleton().frame(maxWidth: .infinity).frame(height: 14)
            Skeleton().frame(maxWidth: .infinity).frame(height: 14)
            Skeleton().frame(width: 220, height: 14)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(
            Rectangle().fill(Color.border).frame(height: 0.5),
            alignment: .bottom
        )
    }
}

/// Boycott-card-shaped skeleton block.
struct BoycottCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Skeleton().frame(width: 180, height: 14)
            Skeleton().frame(width: 140, height: 10)
            HStack(spacing: 6) {
                Skeleton().frame(width: 70, height: 22)
                Skeleton().frame(width: 50, height: 22)
                Skeleton().frame(width: 80, height: 22)
            }
        }
        .cardStyle()
    }
}
