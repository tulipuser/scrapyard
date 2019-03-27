import {
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_GROUP,
    NODE_TYPE_SHELF,
    NODE_TYPE_SEPARATOR,
    DEFAULT_SHELF_NAME
} from "./db.js"

import Storage from "./db.js"

class IDBBackend {

    constructor() {
        this.db = new Storage();
    }

    _normalizePath(path) {
        if (path) {
            path = path.trim();
            if (path.startsWith("/"))
                path = DEFAULT_SHELF_NAME + path;
            else if (!path)
                path = DEFAULT_SHELF_NAME;

            return path;
        }
        else
            return DEFAULT_SHELF_NAME;
    }

    _splitPath(path) {
        return this._normalizePath(path).split("/").filter(n => !!n);
    }

    _splitTags(tags) {
        if (tags)
            return tags.split(",").filter(t => !!t);
    }

    listShelves() {
        return this.db.queryShelf();
    }

    async listNodes(options //{search, // filter by node name or URL
                      // path,   // filter by hierarchical node group path, the first item in the path is a name of a shelf
                      // tags,   // filter for node tags (string array)
                      // types,  // filter for node types (array of integers)
                      // limit,  // limit for the returned record number
                      // depth,  // specify depth of search: "group", "subtree" or "root+subtree"
                      // order   // order mode to sort the output if specified: "custom", "todo"
                      //}
              ) {
        let group = options.path? await this._queryGroup(options.path): null;

        if (options.tags)
            options.tags = this._splitTags(options.tags);

        return await this.db.queryNodes(group, options);
    }

    reorderNodes(positions) {
        return this.db.updateNodes(positions);
    }

    setTODOState(states) {
        return this.db.updateNodes(states);
    }

    // returns map of groups the function was able to find in the path
    async _queryGroups(path_list) {
        path_list = path_list.slice(0);

        let groups = {};
        let shelf_name = path_list.shift();
        let shelf = await this.db.queryShelf(shelf_name);

        if (shelf)
            groups[shelf.name.toLowerCase()] = shelf;
        else
            return {};

        let parent = shelf;
        for (let name of path_list) {
            if (parent) {
                let group = await this.db.queryGroup(parent.id, name);
                groups[name.toLowerCase()] = group;
                parent = group;
            }
            else
                break;
        }

        return groups;
    }

    // returns the last group in path if it exists
    async _queryGroup(path) {
        let path_list = this._splitPath(path);
        let groups = await this._queryGroups(path_list);

        return groups[path_list[path_list.length - 1]];
    }

    // creates all non-existent groups
    async _getGroup(path) {
        let path_list = this._splitPath(path);
        let groups = await this._queryGroups(path_list);
        let shelf_name = path_list.shift();
        let parent = groups[shelf_name.toLowerCase()];


        if (!parent) {
            parent = await this.db.addNode({
                name: shelf_name,
                type: NODE_TYPE_SHELF
            });
        }

        for (let name of path_list) {
            let group = groups[name.toLowerCase()];

            if (group) {
                parent = group;
            }
            else
                parent = await this.db.addNode({
                    parent_id: parent.id,
                    name: name,
                    type: NODE_TYPE_GROUP
                });
        }

        return parent;
    }

    async _ensureUnique(parent_id, name) {
        let children;

        if (parent_id)
            children = (await this.db.getChildNodes(parent_id)).map(c => c.name);
        else
            children = (await this.db.queryShelf()).map(c => c.name);

        let original = name;
        let n = 1;

        while (children.filter(c => !!c).some(c => c.toLocaleUpperCase() === name.toLocaleUpperCase())) {
            name = original + " (" + n + ")";
            n += 1
        }

        return name;
    }

    async createGroup(parent_id, name, node_type = NODE_TYPE_GROUP) {
        let {id} = await this.db.addNode({
            name: await this._ensureUnique(parent_id, name),
            type: node_type,
            parent_id: parent_id
        });

        return this.db.getNode(id);
    }

    async renameGroup(id, new_name) {
        let group = await this.db.getNode(id);
        if (group.name !== new_name) {
            group.name = await this._ensureUnique(group.parent_id, new_name);
            await this.db.updateNode(group);
        }
        return group;
    }

    async addSeparator(parent_id) {
        let {id} = await this.db.addNode({
            type: NODE_TYPE_SEPARATOR,
            parent_id: parent_id
        });

        return this.db.getNode(id);
    }

    async moveNodes(ids, dest_id) {
        let nodes = await this.db.getNodes(ids);

        for (let n of nodes) {
            n.parent_id = dest_id;
            n.name = await this._ensureUnique(dest_id, n.name);
        }

        await this.db.updateNodes(nodes);
        return this.db.queryFullSubtree(ids);
    }

    async copyNodes(ids, dest_id) {
        let all_nodes = await this.db.queryFullSubtree(ids);

        for (let n of all_nodes) {
            let old_id = n.id;
            if (ids.some(n => n === old_id))
                n.parent_id = dest_id;
            n.name = await this._ensureUnique(dest_id, n.name);
            delete n.id;
            delete n.date_modified;
            await this.db.addNode(n, false);
            n.old_id = old_id;
            for (let nn of all_nodes) {
                if (nn.parent_id === old_id)
                    nn.parent_id = n.id;
            }
        }

        return all_nodes;
    }

    async deleteNodes(ids) {
        let all_nodes = await this.db.queryFullSubtree(ids);
        return this.db.deleteNodes(all_nodes.map(n => n.id));
    }

    async addBookmark(data) {
        let group = await this._getGroup(data.path);

        delete data.path;
        data.parent_id = group.id;
        data.type = NODE_TYPE_BOOKMARK;
        data.tags = this._splitTags(data.tags);

        return this.db.addNode(data);
    }

    updateBookmark(data) {
        return this.db.updateNode(data);
    }
}



// let backend = new HTTPBackend("http://localhost:31800", "default:default");
let backend = new IDBBackend();

export {backend};
