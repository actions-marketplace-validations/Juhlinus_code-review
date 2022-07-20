import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';

async function run(): Promise<void> {
  try {
    const token = core.getInput('token');
    // API: https://actions-cool.github.io/octokit-rest/
    const octokit = new Octokit({ auth: `token ${token}` });

    const context = github.context;

    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request?.number ?? -1;

    if (prNumber === -1) {
      throw new Error('Invalid PR number');
    }

    const json = JSON.parse(core.getInput('json_output'));

    const files: { errors: any; diffs: any; } = json.files;

    const comments = [];

    for (const [file_path, value] of Object.entries(files)) {
      const errors = value.errors
        .filter((val: { message: any; line: any }, index: any, self: any[]) => {
          return (
            index ===
            self.findIndex(obj => {
              return obj.message === val.message && obj.line === val.line;
            })
          );
        })
        .map((error: { file_path: any; message: any; source_class: any; line: any }) => {
          return {
            path: error.file_path,
            body: `${error.message}\n\nSource: ${error.source_class}`,
            line: error.line,
          };
        });

      const diffs = value.diffs
        .map((val: { diff: string; applied_checkers: any }) => {
          const diff = val.diff.split(/(@@[0-9\s,+-]+@@)/);

          const head = diff.splice(0, 1);

          const patches = [];

          while (diff.length > 0) {
            patches.push([...head, ...diff.splice(0, 2)].join(''));
          }

          return { diff: patches, applied_checkers: val.applied_checkers };
        })
        .flat(1)
        .map((diff: { diff: any[]; applied_checkers: any[] }) => {
          return diff.diff.map(d => {
            const matches = d.match(/@@ \-([0-9]+)\,([0-9]+)\s\+([0-9]+)\,([0-9]+)/).splice(1);

            const splices = [];

            while (matches.length > 0) {
              splices.push(matches.splice(0, 2));
            }

            const minLine = Math.min(splices[0][0], splices[1][0]);
            const maxLine = Math.max(splices[0][0], splices[1][0]);

            // Might need in the future
            // var minIncrement = Math.min(splices[0][1], splices[1][1]);
            // var maxIncrement = Math.max(splices[0][1], splices[1][1]);

            // var increment = Math.max(minIncrement, maxIncrement);

            return {
              path: file_path,
              line: maxLine,
              start_line: minLine,
              body: diff.applied_checkers.join('\n'),
            };
          });
        })
        .flat(1);

      comments.push(...diffs);
      comments.push(...errors);
    }

    // Create review
    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: 'COMMENT',
      comments: comments,
    });
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
