import { SchemaType } from "../types";
// class Schema<T> {
//     constructor(schema: any) {
//         console.log(schema);
//     }
//     get(data:T){
//         console.log("Hello")
//     }
// }

// export default Schema;

// type UserSchemaType = {
//     firstName: string;
//     lastName: string;
//     email: string;
//     password: string;
//     profile?: string;
//     userStore?: string;
//     status?: string;
// };

// const userSchema = {
//     firstName: {
//         type: "string",
//         required: true,
//     },
//     lastName: {
//         type: "string",
//         required: true,
//     },
//     email: {
//         type: "string",
//         required: true,
//     },
//     password: {
//         type: "string",
//         required: true,
//     },
//     profile: "string",
//     userStore: {
//         type: "_id",
//         ref: "userStores",
//     },
//     status: {
//         type: "string",
//         default: "inactive",
//     },
// };

// const createSchema = new Schema<UserSchemaType>(userSchema);

// const userStoreSchema = {
//     user: {
//         type: "_id",
//         ref: "users",
//         required: true,
//     },
//     customerId: "string",
//     currentPlan: {
//         type: "_id",
//         ref: "Plan",
//     },
//     wishlist: {
//         type: "array",
//         item: {
//             type: "_id",
//             ref: "product",
//         },
//     },
// };

class Schema<T> {
    constructor(schema: SchemaType) {
        console.log(schema);
    }
    get(data: T) {
        console.log("Hello");
    }
}

const productSchema = {
    title: {
        type: "string",
        required: true,
    },
    categories: {
        type: "array",
        item: {
            type: "string",
        },
    },
    type: {
        type: "string",
        required: true,
    },
    isVisible: {
        type: "boolean",
        default: true,
    },
    licenses: {
        type: "object",
        properties: {
            personal: {
                type: "object",
                properties: {
                    pdf: "string",
                    price: "string",
                },
            },
            commercial: {
                type: "object",
                properties: {
                    pdf: "string",
                    price: "string",
                },
            },
            buyout: {
                type: "object",
                properties: {
                    pdf: "string",
                    price: "string",
                },
            },
        },
    },
    ratings: {
        type: "array",
        item: {
            type: "_id",
            ref: "productRatings",
        },
    },

    comments: {
        type: "array",
        item: {
            type: "_id",
            ref: "productComments",
        },
    },
    description: {
        type: "string",
    },
    services: {
        type: "array",
        item: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    required: true,
                },
                price: {
                    type: "number",
                    required: true,
                },
            },
        },
    },
    liveLink: { type: "string" },
    softwares: {
        type: "array",
        item: { type: "string" },
    },
    files: {
        type: "object",
        properties: {
            images: {
                type: "array",
                item: { type: "string" },
            },
            source: "string",
            thumbnail: "string",
        },
    },
    tags: {
        type: "array",
        item: { type: "string" },
    },
    views: {
        type: "number",
        default: 0,
    },
    downloads: {
        type: "number",
        default: 0,
    },
};

const schema = new Schema({
    hello: {
        type: "object",
        properties: {
            hi: {
                type: "string",
            },
            hello: {
                type: "object",
            },
        },
    },
});
