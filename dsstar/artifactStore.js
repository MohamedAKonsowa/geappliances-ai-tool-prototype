/**
 * DS-Star Artifact Store
 * Handles saving iteration artifacts to the runs folder
 */

const fs = require('fs/promises');
const path = require('path');

/**
 * Create a run directory with iteration subfolders
 * @param {string} runsDir - Base runs directory
 * @param {string} runId - Run identifier
 * @returns {Promise<string>} - Path to run directory
 */
async function createRunDir(runsDir, runId) {
    const runDir = path.join(runsDir, runId);
    await fs.mkdir(runDir, { recursive: true });
    return runDir;
}

/**
 * Save iteration artifacts
 * @param {string} runDir - Run directory path
 * @param {number} iteration - Iteration number
 * @param {object} artifacts - Artifacts to save
 */
async function saveIterationArtifacts(runDir, iteration, artifacts) {
    const iterDir = path.join(runDir, `iter_${iteration}`);
    await fs.mkdir(iterDir, { recursive: true });

    const writes = [];

    if (artifacts.prompt) {
        writes.push(fs.writeFile(
            path.join(iterDir, 'prompt.txt'),
            artifacts.prompt,
            'utf8'
        ));
    }

    if (artifacts.plan) {
        writes.push(fs.writeFile(
            path.join(iterDir, 'plan.json'),
            JSON.stringify(artifacts.plan, null, 2),
            'utf8'
        ));
    }

    if (artifacts.planCritique) {
        writes.push(fs.writeFile(
            path.join(iterDir, 'plan_critique.json'),
            JSON.stringify(artifacts.planCritique, null, 2),
            'utf8'
        ));
    }

    if (artifacts.html) {
        writes.push(fs.writeFile(
            path.join(iterDir, 'html.html'),
            artifacts.html,
            'utf8'
        ));
    }

    if (artifacts.codeCritique) {
        writes.push(fs.writeFile(
            path.join(iterDir, 'code_critique.json'),
            JSON.stringify(artifacts.codeCritique, null, 2),
            'utf8'
        ));
    }

    if (artifacts.smokeTest) {
        writes.push(fs.writeFile(
            path.join(iterDir, 'smoke_test.json'),
            JSON.stringify(artifacts.smokeTest, null, 2),
            'utf8'
        ));
    }

    if (artifacts.meta) {
        writes.push(fs.writeFile(
            path.join(iterDir, 'meta.json'),
            JSON.stringify(artifacts.meta, null, 2),
            'utf8'
        ));
    }

    await Promise.all(writes);
    return iterDir;
}

/**
 * Save final outputs
 * @param {string} runDir - Run directory
 * @param {object} final - Final outputs (plan, html)
 */
async function saveFinalOutputs(runDir, final) {
    const writes = [];

    if (final.plan) {
        writes.push(fs.writeFile(
            path.join(runDir, 'final_plan.json'),
            JSON.stringify(final.plan, null, 2),
            'utf8'
        ));
    }

    if (final.html) {
        writes.push(fs.writeFile(
            path.join(runDir, 'final.html'),
            final.html,
            'utf8'
        ));
    }

    await Promise.all(writes);
}

/**
 * Save run summary
 * @param {string} runDir - Run directory
 * @param {object} summary - Run summary
 */
async function saveSummary(runDir, summary) {
    await fs.writeFile(
        path.join(runDir, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf8'
    );
}

module.exports = {
    createRunDir,
    saveIterationArtifacts,
    saveFinalOutputs,
    saveSummary
};
