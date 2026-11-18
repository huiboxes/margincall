let input = '';
for await (const chunk of process.stdin) input += chunk;
const dangerous = [
  /Remove-Item[^\n]*(?:-Recurse|-Force)/i,
  /\brm\s+-rf\b/i,
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-[^\s]*f/i,
  /git\s+push[^\n]*--force/i
];
if (dangerous.some((pattern) => pattern.test(input))) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      permissionDecision: 'ask',
      permissionDecisionReason: '命令可能删除未提交内容或重写远端历史，请确认。'
    }
  }));
}
