module.exports = {
  apps: [{
    name: "ai_guardian_pipeline",
    script: "main.py",
    interpreter: "python",
    watch: false,
    autorestart: true
  }]
};