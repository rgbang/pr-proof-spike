const items = () => "[...document.querySelectorAll('#list li span')].map(s => s.textContent)";

export default function (t) {
  t.test("Page loads",
    "First, the basics. We open the to-do app and check that the title, the empty list and the task counter all appear as they should.",
    async () => {
      await t.check("Title is shown", "document.querySelector('h1').textContent === 'Tiny To-do'");
      await t.check("List starts empty", "document.querySelectorAll('#list li').length === 0");
      await t.check("Counter says zero", "document.getElementById('count').textContent === '0 tasks left'");
    });

  t.test("Add a task",
    "Now we add a real task by typing it in and pressing Add. The task must appear in the list, and the counter must say one task is left.",
    async () => {
      await t.click("#new-task");
      await t.type("#new-task", "Buy milk");
      await t.click("#add-btn");
      await t.check("Task is listed", `${items()}.includes('Buy milk')`);
      await t.check("Counter says one", "document.getElementById('count').textContent === '1 task left'");
      await t.check("Input is cleared", "document.getElementById('new-task').value === ''");
    });

  t.test("Empty task is refused",
    "Next, a mistake a user might make. We press Add with nothing typed. The app must show a friendly message and must not add an empty task.",
    async () => {
      await t.click("#add-btn");
      await t.check("Message is shown", "document.getElementById('error').textContent === 'Please type a task first.'");
      await t.check("Nothing was added", "document.querySelectorAll('#list li').length === 1");
    });

  t.test("Add more tasks",
    "Let us add two more tasks, so we have three in total. Each one must show up in the list in the order we typed them, and the counter must update.",
    async () => {
      await t.click("#new-task");
      await t.type("#new-task", "Write report");
      await t.click("#add-btn");
      await t.click("#new-task");
      await t.type("#new-task", "Call the dentist");
      await t.click("#add-btn");
      await t.check("Three tasks in order", `JSON.stringify(${items()}) === JSON.stringify(['Buy milk','Write report','Call the dentist'])`);
      await t.check("Counter says three", "document.getElementById('count').textContent === '3 tasks left'");
      await t.check("Error message is gone", "document.getElementById('error').textContent === ''");
    });

  t.test("Tick a task off",
    "Now we tick off the first task as done. It must be crossed out in the list, and the counter must drop to two tasks left.",
    async () => {
      await t.click("document.querySelector('#list li .toggle')");
      await t.check("First task is marked done", "document.querySelector('#list li').classList.contains('done') === true");
      await t.check("Counter says two", "document.getElementById('count').textContent === '2 tasks left'");
    });

  t.test("Filter the list",
    "The app can filter the list. We choose Active, and only unfinished tasks must remain. Then we choose Done, and only the finished task must show.",
    async () => {
      await t.click("[data-filter=active]");
      await t.check("Active shows two tasks", "document.querySelectorAll('#list li').length === 2");
      await t.check("Done task is hidden", `!${items()}.includes('Buy milk')`);
      await t.click("[data-filter=done]");
      await t.check("Done shows one task", `JSON.stringify(${items()}) === JSON.stringify(['Buy milk'])`);
      await t.click("[data-filter=all]");
      await t.check("All shows three tasks", "document.querySelectorAll('#list li').length === 3");
    });

  t.test("Tasks survive a reload",
    "A to-do list is only useful if it remembers. We reload the whole page, and all three tasks and the finished state must still be there.",
    async () => {
      await t.load();
      await t.check("Three tasks after reload", "document.querySelectorAll('#list li').length === 3");
      await t.check("Done state remembered", "document.querySelectorAll('#list li.done').length === 1");
    });

  t.test("Delete a task",
    "Next we delete a task we no longer need. We remove Write report, and it must disappear from the list while the other two stay.",
    async () => {
      await t.click("document.querySelectorAll('#list li .del')[1]");
      await t.check("Task is gone", `JSON.stringify(${items()}) === JSON.stringify(['Buy milk','Call the dentist'])`);
      await t.check("Counter says one", "document.getElementById('count').textContent === '1 task left'");
    });

  t.test("Clear completed",
    "Finally, we clear completed tasks. The finished task must be removed, leaving only the dentist call on the list, with one task left to do.",
    async () => {
      await t.click("#clear-done");
      await t.check("Only open task remains", `JSON.stringify(${items()}) === JSON.stringify(['Call the dentist'])`);
      await t.check("Counter says one", "document.getElementById('count').textContent === '1 task left'");
    });
}
