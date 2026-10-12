/** Serialized local transport; owns neither scientific state nor presentation. */
export function createLocalModelConnection(base = '/api/') {
  let pending = Promise.resolve();
  return {
    request(operation, body) {
      const task = pending.then(async () => {
        const response = await fetch(base + operation, body === undefined ? {} : {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'The model request failed.');
        return payload;
      });
      pending = task.catch(() => {});
      return task;
    },
  };
}
