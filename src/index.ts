import {
    CreateFieldType,
    FieldValue,
    GetOptions,
    SchemaType,
    CommonFieldType,
} from "./types";

class Schema<T extends keyof FieldValue, S extends SchemaType<T>> {
    private __schema: S;
    constructor(schema: S) {
        this.__schema = schema;
    }
    getSchema() {
        return this.__schema;
    }
}

class Model<T extends keyof FieldValue, S extends SchemaType<T>> {
    protected __schema: S;
    constructor(name: string, schema: S) {
        this.__schema = schema;
    }

    async create(data: CreateFieldType<T, S> | CreateFieldType<T, S>[]) {}
    async get(
        data: CommonFieldType<T, S> | CommonFieldType<T, S>[],
        option?: GetOptions<S>
    ) {}
    async update(
        find: CommonFieldType<T, S> | CommonFieldType<T, S>[],
        data: CommonFieldType<T, S>
    ) {}
    async delete(find: CommonFieldType<T, S> | CommonFieldType<T, S>[]) {}
    event(
        event: "update" | "create" | "delete" | "change",
        cb: (data: CommonFieldType<T, S>[]) => void
    ) {}
    async has(find: CommonFieldType<T, S> | CommonFieldType<T, S>[]) {}
}

export = { Model, Schema };
