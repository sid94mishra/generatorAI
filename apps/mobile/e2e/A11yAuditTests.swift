import XCTest

private struct AuditRoute: Decodable {
  let name: String
  let route: String
  let ready: String?
  let readyLabel: String?
}

private struct AuditException: Decodable {
  let rule: String
  let selector: String
  let reason: String
  let decision: String
  let auditType: String?
}

@MainActor
final class A11yAuditTests: XCTestCase {
  private func resource<T: Decodable>(_ name: String) throws -> T {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
    return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
  }

  func testMainRoutes() throws {
    continueAfterFailure = true
    let routes: [AuditRoute] = try resource("a11y-routes")
    let exceptions: [AuditException] = try resource("a11y-allow")
    XCTAssertFalse(routes.isEmpty, "No routes configured for the accessibility audit")
    let app = XCUIApplication(bundleIdentifier: "dev.generatorai.app")
    #if DEBUG
    // A development client needs its Metro bundle selected before app links.
    // XCUIApplication.open relaunches, so subsequent debug links use the OS
    // open API, preserving the already loaded React context (08 §4.2).
    var bundle = URLComponents(string: "exp+generatorai://expo-development-client/")!
    bundle.queryItems = [
      URLQueryItem(name: "url", value: ProcessInfo.processInfo.environment["GAI_A11Y_METRO_URL"] ?? "http://127.0.0.1:8081"),
      URLQueryItem(name: "disableFab", value: "1"),
      URLQueryItem(name: "disableOnboarding", value: "1"),
      URLQueryItem(name: "disableAutoLaunch", value: "1"),
    ]
    app.activate()
    XCUIDevice.shared.system.open(try XCTUnwrap(bundle.url))
    guard app.buttons["Open sidebar"].waitForExistence(timeout: 60) else {
      XCTFail("Development client did not load the paired app. Check Metro on :8081 and sandbox pairing.")
      return
    }
    #else
    app.activate()
    #endif
    for route in routes {
      try XCTContext.runActivity(named: route.name) { activity in
        let url = try XCTUnwrap(URL(string: "generatorai:///\(route.route)"))
        #if DEBUG
        XCUIDevice.shared.system.open(url)
        #else
        app.open(url)
        #endif
        let ready: XCUIElement
        if let identifier = route.ready {
          ready = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        } else if let label = route.readyLabel {
          ready = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        } else {
          XCTFail("\(route.name) has no readiness selector")
          return
        }
        guard ready.waitForExistence(timeout: 30) else {
          XCTFail("\(route.name) did not reach its readiness selector. Pair this simulator with the sandbox first.")
          return
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = route.name
        screenshot.lifetime = .keepAlways
        activity.add(screenshot)
        do {
          try app.performAccessibilityAudit(for: .all) { issue in
            Self.isAllowed(issue, exceptions: exceptions)
          }
        } catch {
          // A platform audit failure must remain a failure, while subsequent
          // routes still get evidence instead of silently being skipped.
          XCTFail("\(route.name) accessibility audit did not complete: \(error)")
        }
      }
    }
  }

  private static func isAllowed(_ issue: XCUIAccessibilityAuditIssue, exceptions: [AuditException]) -> Bool {
    let types: [String: XCUIAccessibilityAuditType] = [
      "contrast": .contrast, "elementDetection": .elementDetection, "hitRegion": .hitRegion,
      "sufficientElementDescription": .sufficientElementDescription, "dynamicType": .dynamicType,
      "textClipped": .textClipped, "trait": .trait,
    ]
    guard let element = issue.element else { return false }
    return exceptions.contains { entry in
      guard entry.rule == "native-audit", !entry.reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            entry.decision.range(of: "^MD-[0-9]+(?:\\b.*)?$", options: .regularExpression) != nil,
            let name = entry.auditType, let type = types[name], type == issue.auditType else { return false }
      // Selectors use JSON string quoting, just like the snapshot checker.
      let parts = entry.selector.split(separator: "=", maxSplits: 1).map(String.init)
      guard parts.count == 2, let data = parts[1].data(using: .utf8),
            let value = try? JSONDecoder().decode(String.self, from: data), !value.isEmpty else { return false }
      return (parts[0] == "id" && element.identifier == value) || (parts[0] == "label" && element.label == value)
    }
  }
}
