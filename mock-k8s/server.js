// mock-k8s/server.js
const express = require('express');
const app = express();
const port = 8080;

app.use(express.json());

// Health check
app.get('/healthz', (req, res) => {
    res.status(200).send('ok');
});

// Mock pods/events for RCA testing
app.get('/api/v1/namespaces/:namespace/pods', (req, res) => {
    const { namespace } = req.params;
    res.json({
        kind: 'PodList',
        items: [
            {
                metadata: { name: `pod-${namespace}-1`, namespace },
                status: { phase: 'Running', containerStatuses: [{ ready: true, restartCount: 0 }] }
            }
        ]
    });
});

app.get('/api/v1/namespaces/:namespace/events', (req, res) => {
    res.json({ kind: 'EventList', items: [] });
});

app.listen(port, () => {
    console.log(`Mock K8s API listening at http://localhost:${port}`);
});
