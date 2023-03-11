export type FieldValue = {
    string: string;
    object: object;
    array: any[];
    number: number;
    boolean: boolean;
};

export type DataType = "string" | "object" | "array" | "number" | "boolean";

export type SchemaType<T extends keyof FieldValue> = {
    [field: string]:
        | DataType
        | { type: T; required?: boolean; default?: FieldValue[T] }
        | { type: "_id"; required?: boolean; default?: string; ref: string };
};

type RequiredFields<T extends keyof FieldValue, S extends SchemaType<T>> = {
    [K in keyof S]: S[K] extends { required: true } ? K : never;
}[keyof S];

type OptionalFields<T extends keyof FieldValue, S extends SchemaType<T>> = {
    [K in keyof S]: S[K] extends { required: true } ? never : K;
}[keyof S];

type OtherFieldType<T> = T extends { type: "number" }
    ? number
    : T extends { type: "string" }
    ? string
    : T extends { type: "object" }
    ? object
    : T extends { type: "array" }
    ? any[]
    : T extends { type: "boolean" }
    ? boolean
    : any;

export type CreateFieldType<
    T extends keyof FieldValue,
    S extends SchemaType<T>
> = {
    [K in RequiredFields<T, S>]: S[K] extends DataType
        ? FieldValue[S[K]]
        : OtherFieldType<S[K]>;
} & {
    [K in OptionalFields<T, S>]?: S[K] extends DataType
        ? FieldValue[S[K]]
        : OtherFieldType<S[K]>;
} & { _id?: string };

export type CommonFieldType<
    T extends keyof FieldValue,
    S extends SchemaType<T>
> = {
    [K in keyof S]?: S[K] extends DataType
        ? FieldValue[S[K]]
        : OtherFieldType<S[K]>;
} & { _id?: string };

export type GetOptions<S> = {
    extend: keyof S | (keyof S)[];
};
