// Simple test data source script that outputs a JSON array to stdout
// Each row provides variables for one automation iteration
const items = [
  { project_name: "TodoApp", language: "TypeScript", framework: "Express" },
  { project_name: "ChatBot", language: "Python", framework: "FastAPI" }
];
console.log(JSON.stringify(items));
