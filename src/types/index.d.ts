type TypeString = "string" | "number" | "object" | "array" | "boolean" | "object" | "_id" | "any";

type CommonDataType<T> = {
    required?: boolean;
    default?: T;
};

type StringDataType = {
    type: "string";
} & CommonDataType<string>;

type ObjectDataType<T> = {
    type: "object";
    properties?: T;
} & CommonDataType<string>;

type ArrayDataType<T> = {
    type: "array";
};

type DataType<T> = StringDataType | ObjectDataType<T>;

export type SchemaType = {
    [field: string]: DataType<SchemaType>;
};
