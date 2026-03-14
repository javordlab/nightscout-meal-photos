const { execSync } = require('child_process');

function getStatus(modelId) {
    try {
        const output = execSync(`openclaw gateway agent --message "/status" --thinking off --agent health-guard --local`).toString();
        // Since --local is used, it might not have the correct context.
        // Let's try without --local but with a dummy session.
        return output;
    } catch (e) {
        return e.stdout.toString();
    }
}

// console.log(getStatus('google-antigravity/gemini-3-flash'));
