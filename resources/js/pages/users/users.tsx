import {Head} from "@inertiajs/react";
import {users} from "@/routes";
import { Card, CardHeader, CardContent, CardDescription, CardFooter, CardTitle } from "@/components/ui/card";
import {Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Pencil, Trash} from "lucide-react";
export default function UsersPage() {
    return (
        <>
            <Head title="Users" />

            <div className="p-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Users</CardTitle>
                        <CardDescription>View, edit or delete users</CardDescription>
                    </CardHeader>

                    <CardContent>
                        <Table>
                            <TableCaption>Een lijst van de actieve gebruikers.</TableCaption>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[100px]">ID</TableHead>
                                    <TableHead>Naam</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead className="text-center">Acties</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow>
                                    <TableCell className="font-medium">1</TableCell>
                                    <TableCell>Jan Janssen</TableCell>
                                    <TableCell>jan@voorbeeld.nl</TableCell>
                                    <div className="flex justify-center mt-2">
                                        <a href="#" className="mr-2 hover:text-blue-600"><Pencil/></a>
                                        <a href="#" className="hover:text-blue-600"><Trash /></a>
                                    </div>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </>
    );
}

UsersPage.layout = {
    breadcrumbs: [
        {
            title: 'Users',
            href: users(),
        },
    ],
};
