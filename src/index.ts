import joplin from 'api';
import * as joplinData from './data';
import { SettingItemType, ToolbarButtonLocation } from 'api/types';
var deepEqual = require('deep-equal')

const DEFAULT_MAX_NOTES = 700;

async function createSettings() {
  const sectionName = "graph-ui.settings"
  await joplin.settings.registerSection(sectionName, {
    label: 'Graph UI',
    // Check out https://forkaweso.me/Fork-Awesome/icons/ for available icons.
    iconName: 'fas fa-sitemap'
  });

  await joplin.settings.registerSetting('maxNodesOnGraph', {
    value: DEFAULT_MAX_NOTES,
    type: SettingItemType.Int,
    section: sectionName,
    public: true,
    label: 'Max nodes in graph',
    description: 'Maximun number of nodes shown in the graph. Most recent nodes have priority.'
  });

  await joplin.settings.registerSetting("filteredNotebookNames", {
    value: "",
    type: SettingItemType.String,
    section: sectionName,
    public: true,
    label: "Notebooks names to filter out",
    description: "Comma separated list of Notebook names to filter.",
  });
}

async function getFilteredNotebooks(notebooks) {
  const filteredNotebookNames = await joplin.settings.value("filteredNotebookNames");
  if ("" === filteredNotebookNames) return new Set();

  const allNotebooks = new Map();
  notebooks.forEach(n => allNotebooks.set(n.title, n.id))

  var namesToFilter = filteredNotebookNames.split(",");
  namesToFilter = namesToFilter.filter(name => allNotebooks.has(name));
  namesToFilter = namesToFilter.map(name => allNotebooks.get(name));  // Name to ID
  return new Set(namesToFilter);
}

async function fetchData() {
  const selectedNote = await joplin.workspace.selectedNote();
  const notes = await joplinData.getNotes();
  const notebooks = await joplinData.getNotebooks();
  // Set of notebook IDs to filter out of the graph view.
  var filteredNotebooks = await getFilteredNotebooks(notebooks);

  const data = {
    "nodes": [],
    "edges": [],
    "currentNoteID": selectedNote.id,
  };

  notes.forEach(function(note, id) {
    if (!filteredNotebooks.has(note.parent_id)) {
      data.nodes.push({
        "id": id,
        "title": note.title,
      })

      var links = note["links"]
      if (links.length > 0) {
        for (const link of links) {
          var linkDestExists = notes.has(link);
          if (linkDestExists) {
            data.edges.push({
              "source": id,
              "target": link,
            });
          }
        }
      }
    }
  });
  return data;
}

joplin.plugins.register({
  onStart: async function() {
    await createSettings();
    const panels = joplin.views.panels;
    const view = await (panels as any).create();
    var prevData = {};
    var syncOngoing = false;
    var data = await fetchData();

    // Create a toolbar button
    await joplin.commands.register({
      name: 'showHideGraphUI',
      label: 'Show/Hide Graph View',
      iconName: 'fas fa-sitemap',
      execute: async () => {
        const isVisible = await (panels as any).visible(view);
        (panels as any).show(view, !isVisible);
      },
    });
    await joplin.views.toolbarButtons.create('graphUIButton', 'showHideGraphUI', ToolbarButtonLocation.NoteToolbar);

    // Build Panel
    await panels.addScript(view, './d3.min.js');
    await panels.addScript(view, './webview.css');
    await panels.addScript(view, './note-graph.js');
    panels.onMessage(view, (message:any) => {
      if (message.name === "d3JSLoaded") {
        prevData = data
        return data;
      } else if (message.name === "checkForUpdate") {
        if (message.force === true) {
          prevData = data
          return data;
        }

        if (!syncOngoing) {
          var sameData = deepEqual(data, prevData)
          if (!sameData) {
            prevData = data
            return data;
          }
        }

        return undefined;
      } else if (message.name === "navigateTo") {
        joplin.commands.execute('openNote', message.id)
      }
    });

    await panels.setHtml(view, `
                <div class="outline-content">
                    <div class="header-area">
                      <button onclick="refreshData(true)">Redraw Graph</button>
                      <p class="header">Note Graph</p>
                    </div>
                    <div class="container">
                      <div id="note_graph"/>
                    </div>
      </div>
    `);

    async function updateGraphView() {
      data = await fetchData();
    };

    await joplin.workspace.onNoteChange(() => {
      updateGraphView();
    });
    await joplin.workspace.onNoteSelectionChange(() => {
      updateGraphView();
    });
    await joplin.settings.onChange(() => {
      updateGraphView();
    });

    await joplin.workspace.onSyncStart(() => {
      syncOngoing = true;
    });
    await joplin.workspace.onSyncComplete(() => {
      syncOngoing = false;
    });

  },
});
