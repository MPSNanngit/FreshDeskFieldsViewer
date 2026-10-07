module.exports = {
  test: {
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["app/scripts/engine.js"],
      reportsDirectory: "coverage/unit",
      reporter: ["text", "json", "json-summary", "lcov"]
    }
  }
};
