import {prisma} from "@/lib/prisma";

await prisma.test.findAll({});